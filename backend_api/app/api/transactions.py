import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from app.core.auth import get_current_user_id
from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import ConsentRequiredError
from app.schemas.schemas import (
    CategoryCorrectionRequest,
    RetrainResponse,
    SMSIngestRequest,
    SMSSyncFailedItem,
    SMSSyncResponse,
    SMSSyncSensitiveWarning,
    SMSTransactionListResponse,
    SMSTransactionOut,
    UserPromptResponse,
)
from app.services.model_service import model_service, run_category_prediction
from app.services.retraining_service import create_job, retrain_category_model
from app.services.sms_parser import detect_sensitive_flags, parse_momo_sms

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Helpers ---

def _build_clarification_prompt(tx: dict) -> str:
    amount = int(tx["amount_rwf"])
    to_who = tx.get("to_who") or "someone"
    tx_time = (tx.get("transaction_time") or "")[:16].replace("T", " ")
    return (
        f"You sent {amount:,} RWF to {to_who}"
        + (f" at {tx_time}" if tx_time else "")
        + ". What were you paying for?"
    )


def _try_auto_match(conn, user_id: str, sms_id: int, amount_rwf: float,
                    transaction_time: Optional[str]) -> list[int]:
    """
    Find unmatched purchase_details that are plausibly linked to this SMS.
    Criteria: same user, unlinked, total_cost_rwf within 10% of amount_rwf,
    purchase_time within 2 hours of transaction_time.
    """
    if not transaction_time:
        return []
    rows = conn.execute(
        """
        SELECT pd.id, pd.total_cost_rwf
        FROM purchase_details pd
        WHERE pd.user_id = ?
          AND pd.id NOT IN (
              SELECT purchase_detail_id FROM transaction_purchase_matches
              WHERE match_status NOT IN ('unmatched', 'rejected')
          )
          AND ABS(CAST(strftime('%s', pd.purchase_time) AS REAL)
               -  CAST(strftime('%s', ?) AS REAL)) <= 7200
          AND ABS(pd.total_cost_rwf - ?) / MAX(?, 1) <= 0.10
        LIMIT 20
        """,
        (user_id, transaction_time, amount_rwf, amount_rwf),
    ).fetchall()
    return [r["id"] for r in rows]


def _get_purchase_details_for_transaction(conn, sms_id: int) -> list:
    """
    Fetch all purchase details linked to an SMS transaction via transaction_purchase_matches.
    Returns a list of PurchaseDetailOut objects.
    """
    rows = conn.execute(
        """
        SELECT pd.id, pd.source_type, pd.item_name, pd.normalized_item_name,
               pd.quantity, pd.unit, pd.unit_cost_rwf, pd.total_cost_rwf,
               pd.merchant_name, pd.purchase_time, pd.created_at,
               ec.predicted_category, ec.final_category, ec.confidence
        FROM purchase_details pd
        JOIN transaction_purchase_matches tpm ON tpm.purchase_detail_id = pd.id
        LEFT JOIN expense_categories ec ON ec.purchase_detail_id = pd.id
        WHERE tpm.sms_transaction_id = ?
          AND tpm.match_status NOT IN ('unmatched', 'rejected')
        ORDER BY pd.id
        """,
        (sms_id,),
    ).fetchall()
    
    from app.schemas.schemas import PurchaseDetailOut
    result = []
    for r in rows:
        row_dict = dict(r)
        result.append(
            PurchaseDetailOut(
                id=row_dict["id"],
                source_type=row_dict["source_type"],
                item_name=row_dict["item_name"],
                normalized_item_name=row_dict.get("normalized_item_name"),
                quantity=row_dict.get("quantity", 1.0),
                unit=row_dict.get("unit"),
                unit_cost_rwf=row_dict.get("unit_cost_rwf"),
                total_cost_rwf=row_dict["total_cost_rwf"],
                merchant_name=row_dict.get("merchant_name"),
                purchase_time=row_dict.get("purchase_time"),
                predicted_category=row_dict.get("predicted_category"),
                final_category=row_dict.get("final_category"),
                category_confidence=row_dict.get("confidence"),
                created_at=row_dict.get("created_at"),
            )
        )
    return result


def _rebuild_monthly_aggregates(conn, user_id: str, year: int, month: int) -> None:
    """Incrementally refresh monthly_financial_aggregates for one (user, year, month)."""
    period_start = f"{year}-{month:02d}-01"
    period_end   = f"{year}-{month:02d}-31"

    # Income from sms_transactions
    income_row = conn.execute(
        """
        SELECT COALESCE(SUM(amount_rwf), 0)   AS total,
               COUNT(*)                        AS cnt,
               COALESCE(AVG(amount_rwf), 0)   AS avg
        FROM sms_transactions
        WHERE user_id = ? AND transaction_type = 'income'
          AND transaction_time >= ? AND transaction_time <= ?
        """,
        (user_id, period_start, period_end),
    ).fetchone()

    # Expense totals per category from expense_records_view
    cat_rows = conn.execute(
        """
        SELECT COALESCE(final_category, 'Uncategorised') AS category,
               COALESCE(SUM(total_cost_rwf), 0)          AS total,
               COUNT(*)                                   AS cnt,
               COALESCE(AVG(total_cost_rwf), 0)          AS avg
        FROM expense_records_view
        WHERE user_id = ?
          AND transaction_time >= ? AND transaction_time <= ?
          AND total_cost_rwf IS NOT NULL
        GROUP BY category
        """,
        (user_id, period_start, period_end),
    ).fetchall()

    now = datetime.now(timezone.utc).isoformat()

    # Upsert income row (category = NULL)
    conn.execute(
        """
        INSERT INTO monthly_financial_aggregates
            (user_id, year, month, category,
             total_income_rwf, income_transaction_count,
             average_income_amount_rwf, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(user_id, year, month, category) DO UPDATE SET
            total_income_rwf          = excluded.total_income_rwf,
            income_transaction_count  = excluded.income_transaction_count,
            average_income_amount_rwf = excluded.average_income_amount_rwf,
            updated_at                = excluded.updated_at
        """,
        (user_id, year, month, float(income_row["total"]),
         int(income_row["cnt"]), float(income_row["avg"]), now),
    )

    # Upsert one row per expense category
    for r in cat_rows:
        conn.execute(
            """
            INSERT INTO monthly_financial_aggregates
                (user_id, year, month, category,
                 total_expense_rwf, expense_transaction_count,
                 average_expense_amount_rwf, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, year, month, category) DO UPDATE SET
                total_expense_rwf          = excluded.total_expense_rwf,
                expense_transaction_count  = excluded.expense_transaction_count,
                average_expense_amount_rwf = excluded.average_expense_amount_rwf,
                updated_at                 = excluded.updated_at
            """,
            (user_id, year, month, r["category"],
             float(r["total"]), int(r["cnt"]), float(r["avg"]), now),
        )


# POST /transactions/sms/sync
@router.post(
    "/sms/sync",
    response_model=SMSSyncResponse,
    summary="Parse and store confirmed MoMo SMS messages",
)
def sync_sms(
    payload: SMSIngestRequest,
    user_id: str = Depends(get_current_user_id),
) -> SMSSyncResponse:
    """
    Accept a user-confirmed batch of MTN MoMo or Airtel Money SMS messages,
    parse them into structured transactions, and persist them.

    **Deduplication** (checked in order):
    1. ``source_message_id`` (device-side ID, if provided)
    2. ``transaction_reference`` (MM/FT/TxId from the SMS text)
    3. Hash + transaction time + amount (fallback when no reference is present)

    **Response buckets**:
    - ``imported`` — parsed and stored successfully
    - ``duplicates_skipped`` — already in the database (count only)
    - ``failed`` — no matching pattern; not stored; returned for manual review
    - ``sensitive_warnings`` — contained security-sensitive keywords; not stored
    """
    logger.info("=== SMS Sync Debug ===")
    logger.info("Payload type: %s", type(payload))
    logger.info("Consent confirmed: %s", payload.consent_confirmed)
    logger.info("Messages count: %d", len(payload.messages))
    if payload.messages:
        logger.info("First message type: %s", type(payload.messages[0]))
        logger.info("First message data: %s", payload.messages[0])
    
    if not payload.consent_confirmed:
        raise ConsentRequiredError()

    imported:           list[dict]                    = []
    duplicates_skipped: int                           = 0
    failed:             list[SMSSyncFailedItem]       = []
    sensitive_warnings: list[SMSSyncSensitiveWarning] = []
    months_touched:     set[tuple]                   = set()

    with get_db() as conn:
        for idx, msg in enumerate(payload.messages):

            # -- 1. Sensitive keyword check --
            flags = detect_sensitive_flags(msg.raw_sms_text)
            if flags:
                sensitive_warnings.append(
                    SMSSyncSensitiveWarning(
                        index=idx,
                        sender=msg.sender,
                        sms_time=msg.sms_time,
                        sensitive_flags=flags,
                    )
                )
                logger.warning(
                    "SMS #%d from '%s' flagged as sensitive (%s); not stored.",
                    idx, msg.sender, flags,
                )
                continue

            # -- 2. Parse --
            parsed = parse_momo_sms(msg.raw_sms_text, sender=msg.sender)

            # -- 3. Failed parse --
            if parsed.parse_confidence == 0.0:
                failed.append(
                    SMSSyncFailedItem(
                        index=idx,
                        sender=msg.sender,
                        sms_time=msg.sms_time,
                        raw_sms_hash=parsed.raw_sms_hash,
                        reason="No matching pattern found for this SMS format.",
                    )
                )
                logger.debug("SMS #%d from '%s' could not be parsed.", idx, msg.sender)
                continue

            # -- 4a. Dedup by source_message_id --
            if msg.source_message_id:
                existing = conn.execute(
                    "SELECT id FROM sms_transactions"
                    " WHERE user_id = ? AND source_message_id = ?",
                    (user_id, msg.source_message_id),
                ).fetchone()
                if existing:
                    duplicates_skipped += 1
                    logger.debug("Skipping dup source_message_id=%s", msg.source_message_id)
                    continue

            # -- 4b. Dedup by transaction_reference --
            if parsed.transaction_reference:
                existing = conn.execute(
                    "SELECT id FROM sms_transactions"
                    " WHERE user_id = ? AND transaction_reference = ?",
                    (user_id, parsed.transaction_reference),
                ).fetchone()
                if existing:
                    duplicates_skipped += 1
                    logger.debug("Skipping duplicate ref=%s", parsed.transaction_reference)
                    continue
            else:
                # -- 4c. Fallback dedup: hash + time + amount --
                existing = conn.execute(
                    "SELECT id FROM sms_transactions"
                    " WHERE user_id = ? AND raw_sms_hash = ?"
                    "   AND transaction_time = ? AND amount_rwf = ?",
                    (
                        user_id, parsed.raw_sms_hash,
                        parsed.transaction_time, parsed.amount_rwf,
                    ),
                ).fetchone()
                if existing:
                    duplicates_skipped += 1
                    logger.debug("Skipping duplicate by hash/time/amount")
                    continue

            # -- 5. Persist --
            cursor = conn.execute(
                """
                INSERT INTO sms_transactions (
                    user_id, source_message_id, sender, raw_sms_text, raw_sms_hash,
                    sms_time, transaction_time, transaction_type,
                    amount_rwf, fee_rwf, balance_after_rwf,
                    to_who, from_who, transaction_reference, parse_confidence,
                    provider, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    msg.source_message_id,
                    msg.sender,
                    parsed.raw_sms_text,
                    parsed.raw_sms_hash,
                    msg.sms_time or parsed.sms_time,
                    parsed.transaction_time,
                    parsed.transaction_type,
                    parsed.amount_rwf,
                    parsed.fee_rwf,
                    parsed.balance_after_rwf,
                    parsed.to_who,
                    parsed.from_who,
                    parsed.transaction_reference,
                    parsed.parse_confidence,
                    parsed.provider,
                    parsed.currency,
                ),
            )
            sms_id = cursor.lastrowid

            if parsed.transaction_time:
                try:
                    dt = datetime.fromisoformat(parsed.transaction_time[:10])
                    months_touched.add((dt.year, dt.month))
                except ValueError:
                    pass

            row_out: dict = {
                "id":                    sms_id,
                "transaction_type":      parsed.transaction_type,
                "amount_rwf":            parsed.amount_rwf,
                "fee_rwf":               parsed.fee_rwf,
                "balance_after_rwf":     parsed.balance_after_rwf,
                "to_who":                parsed.to_who,
                "from_who":              parsed.from_who,
                "transaction_time":      parsed.transaction_time,
                "transaction_reference": parsed.transaction_reference,
                "parse_confidence":      parsed.parse_confidence,
                "provider":              parsed.provider,
                "currency":              parsed.currency,
                "created_at":            None,
                "purchase_details":      None,
                "match_status":          None,
                "clarification_prompt":  None,
            }

            # -- 6. Expense: attempt auto-match to purchase_details --
            if parsed.transaction_type == "expense":
                matched_pd_ids = _try_auto_match(
                    conn, user_id, sms_id,
                    parsed.amount_rwf, parsed.transaction_time,
                )
                if matched_pd_ids:
                    for pd_id in matched_pd_ids:
                        conn.execute(
                            "INSERT OR IGNORE INTO transaction_purchase_matches"
                            " (user_id, sms_transaction_id, purchase_detail_id,"
                            "  match_status, matched_by)"
                            " VALUES (?, ?, ?, 'auto_matched', 'system')",
                            (user_id, sms_id, pd_id),
                        )
                    row_out["match_status"] = "auto_matched"
                else:
                    row_out["match_status"]        = "unmatched"
                    row_out["clarification_prompt"] = _build_clarification_prompt(row_out)

            imported.append(row_out)

        # -- 7. Refresh monthly aggregates --
        for (yr, mo) in months_touched:
            _rebuild_monthly_aggregates(conn, user_id, yr, mo)

        # -- 8. Record last successful import timestamp --
        now_iso = datetime.now(timezone.utc).isoformat()
        if imported:
            conn.execute(
                "UPDATE users SET last_sms_import_at = ? WHERE id = ?",
                (now_iso, user_id),
            )

    logger.info(
        "SMS sync for user '%s': %d imported, %d skipped, %d failed, %d sensitive.",
        user_id, len(imported), duplicates_skipped, len(failed), len(sensitive_warnings),
    )
    return SMSSyncResponse(
        imported=[SMSTransactionOut(**r) for r in imported],
        duplicates_skipped=duplicates_skipped,
        failed=failed,
        sensitive_warnings=sensitive_warnings,
        last_import_at=now_iso if imported else None,
    )


# --- GET /transactions/ ---

@router.get(
    "/",
    response_model=SMSTransactionListResponse,
    summary="List SMS transactions with filtering and pagination",
)
def list_transactions(
    page:             int           = Query(default=1, ge=1),
    page_size:        int           = Query(default=50, ge=1, le=200),
    transaction_type: Optional[str] = Query(default=None, description="income or expense"),
    from_date:        Optional[str] = Query(default=None),
    to_date:          Optional[str] = Query(default=None),
    user_id:          str           = Depends(get_current_user_id),
) -> SMSTransactionListResponse:
    if transaction_type and transaction_type not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="transaction_type must be 'income' or 'expense'.")

    conditions = ["user_id = ?"]
    params: list = [user_id]

    if transaction_type:
        conditions.append("transaction_type = ?")
        params.append(transaction_type)
    if from_date:
        conditions.append("transaction_time >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("transaction_time <= ?")
        params.append(to_date)

    where = " AND ".join(conditions)
    offset = (page - 1) * page_size

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS count FROM sms_transactions WHERE {where}", params
        ).fetchone()["count"]

        rows = conn.execute(
            f"SELECT * FROM sms_transactions WHERE {where}"
            f" ORDER BY transaction_time DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            
            # Fetch purchase details for this transaction
            purchase_details = _get_purchase_details_for_transaction(conn, d["id"])
            
            tx_out = SMSTransactionOut(
                id=d["id"],
                transaction_type=d["transaction_type"],
                amount_rwf=d["amount_rwf"],
                fee_rwf=d["fee_rwf"],
                balance_after_rwf=d.get("balance_after_rwf"),
                to_who=d.get("to_who"),
                from_who=d.get("from_who"),
                transaction_time=d.get("transaction_time"),
                transaction_reference=d.get("transaction_reference"),
                parse_confidence=d.get("parse_confidence", 1.0),
                provider=d.get("provider"),
                currency=d.get("currency", "RWF"),
                created_at=d.get("created_at"),
                purchase_details=purchase_details if purchase_details else None,
            )
            items.append(tx_out)

    return SMSTransactionListResponse(
        items=items, total=total, page=page,
        page_size=page_size, has_next=(offset + page_size) < total,
    )


# --- GET /transactions/unmatched ---

@router.get(
    "/unmatched",
    response_model=SMSTransactionListResponse,
    summary="List expense transactions awaiting purchase detail clarification",
)
def list_unmatched(
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user_id:   str = Depends(get_current_user_id),
) -> SMSTransactionListResponse:
    """
    Returns expense SMS transactions that have no linked purchase_details.
    Each item includes a `clarification_prompt` for the user.
    """
    offset = (page - 1) * page_size
    with get_db() as conn:
        total = conn.execute(
            """
            SELECT COUNT(*) AS count FROM sms_transactions st
            WHERE st.user_id = ?
              AND st.transaction_type = 'expense'
              AND NOT EXISTS (
                  SELECT 1 FROM transaction_purchase_matches tpm
                  WHERE tpm.sms_transaction_id = st.id
                    AND tpm.match_status NOT IN ('unmatched', 'rejected')
              )
            """,
            (user_id,),
        ).fetchone()["count"]

        rows = conn.execute(
            """
            SELECT st.*
            FROM sms_transactions st
            WHERE st.user_id = ?
              AND st.transaction_type = 'expense'
              AND NOT EXISTS (
                  SELECT 1 FROM transaction_purchase_matches tpm
                  WHERE tpm.sms_transaction_id = st.id
                    AND tpm.match_status NOT IN ('unmatched', 'rejected')
              )
            ORDER BY st.transaction_time DESC
            LIMIT ? OFFSET ?
            """,
            (user_id, page_size, offset),
        ).fetchall()

    items = []
    for r in rows:
        row_dict = dict(r)
        items.append(
            SMSTransactionOut(
                id=row_dict["id"],
                transaction_type=row_dict["transaction_type"],
                amount_rwf=row_dict["amount_rwf"],
                fee_rwf=row_dict["fee_rwf"],
                balance_after_rwf=row_dict.get("balance_after_rwf"),
                to_who=row_dict.get("to_who"),
                from_who=row_dict.get("from_who"),
                transaction_time=row_dict.get("transaction_time"),
                transaction_reference=row_dict.get("transaction_reference"),
                parse_confidence=row_dict.get("parse_confidence", 1.0),
                provider=row_dict.get("provider"),
                currency=row_dict.get("currency", "RWF"),
                created_at=row_dict.get("created_at"),
                match_status="unmatched",
                clarification_prompt=_build_clarification_prompt(row_dict),
            )
        )
    return SMSTransactionListResponse(
        items=items, total=total, page=page,
        page_size=page_size, has_next=(offset + page_size) < total,
    )


# POST /transactions/{sms_id}/prompt-response 
@router.post(
    "/{sms_id}/prompt-response",
    summary="Submit purchase details for an unmatched expense SMS",
)
def submit_prompt_response(
    sms_id:           int,
    payload:          UserPromptResponse,
    background_tasks: BackgroundTasks,
    user_id:          str = Depends(get_current_user_id),
) -> dict:
    """
    Store the user's answer to the purchase clarification prompt.

    Creates one purchase_details row per item, links them to the SMS via
    transaction_purchase_matches, runs category prediction for each item,
    and refreshes monthly aggregates.
    """
    with get_db() as conn:
        sms = conn.execute(
            "SELECT * FROM sms_transactions WHERE id = ? AND user_id = ?",
            (sms_id, user_id),
        ).fetchone()
        if not sms:
            raise HTTPException(status_code=404, detail="SMS transaction not found.")
        if sms["transaction_type"] != "expense":
            raise HTTPException(status_code=400, detail="Prompt responses are for expense transactions only.")

        pd_ids = []
        for item in payload.items:
            purchase_time = item.purchase_time or sms["transaction_time"]
            cur = conn.execute(
                """
                INSERT INTO purchase_details
                    (user_id, source_type, source_id, purchase_time, merchant_name,
                     item_name, normalized_item_name, quantity, unit,
                     unit_cost_rwf, total_cost_rwf, extraction_confidence)
                VALUES (?, 'user_prompt', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0)
                """,
                (
                    user_id, sms_id, purchase_time,
                    payload.merchant_name,
                    item.item_name,
                    item.normalized_item_name,
                    item.quantity,
                    item.unit,
                    item.unit_cost_rwf,
                    item.total_cost_rwf,
                ),
            )
            pd_id = cur.lastrowid
            pd_ids.append(pd_id)

            conn.execute(
                "INSERT OR IGNORE INTO transaction_purchase_matches"
                " (user_id, sms_transaction_id, purchase_detail_id,"
                "  match_status, match_score, matched_by)"
                " VALUES (?, ?, ?, 'user_confirmed', 1.0, 'user')",
                (user_id, sms_id, pd_id),
            )

            # Category prediction
            from datetime import datetime as _dt
            try:
                pt = _dt.fromisoformat(purchase_time[:10]) if purchase_time else _dt.now()
            except ValueError:
                pt = _dt.now()

            features = {
                "item_name":             item.item_name,
                "normalized_item_name":  item.normalized_item_name,
                "merchant_name":         payload.merchant_name,
                "to_who":                sms["to_who"],
                "quantity":              item.quantity,
                "unit_cost_rwf":         item.unit_cost_rwf or 0.0,
                "total_cost_rwf":        item.total_cost_rwf,
                "purchase_month":        pt.month,
                "purchase_weekday":      pt.weekday(),
            }
            run_category_prediction(user_id, pd_id, features, conn)

        # Refresh monthly aggregates
        if sms["transaction_time"]:
            try:
                dt = datetime.fromisoformat(sms["transaction_time"][:10])
                _rebuild_monthly_aggregates(conn, user_id, dt.year, dt.month)
            except ValueError:
                pass

    logger.info(
        "Prompt response: %d item(s) linked to sms_id=%d for user '%s'.",
        len(pd_ids), sms_id, user_id,
    )
    return {"sms_transaction_id": sms_id, "purchase_detail_ids": pd_ids, "status": "linked"}


# --- PATCH /transactions/{sms_id}/match/{pd_id} ---

@router.patch(
    "/{sms_id}/match/{pd_id}",
    summary="Confirm or reject a system-suggested purchase match",
)
def update_match(
    sms_id:  int,
    pd_id:   int,
    action:  str = Query(..., description="confirm or reject"),
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Set match_status to user_confirmed or rejected for a specific match pair."""
    if action not in ("confirm", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'confirm' or 'reject'.")

    new_status = "user_confirmed" if action == "confirm" else "rejected"
    with get_db() as conn:
        result = conn.execute(
            "UPDATE transaction_purchase_matches"
            " SET match_status = ?, matched_by = 'user'"
            " WHERE sms_transaction_id = ? AND purchase_detail_id = ? AND user_id = ?",
            (new_status, sms_id, pd_id, user_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Match record not found.")
    return {"sms_transaction_id": sms_id, "purchase_detail_id": pd_id, "match_status": new_status}


# --- POST /transactions/corrections ---

@router.post(
    "/corrections",
    response_model=RetrainResponse,
    summary="Correct the category of a purchase item",
)
def add_correction(
    payload:          CategoryCorrectionRequest,
    background_tasks: BackgroundTasks,
    user_id:          str = Depends(get_current_user_id),
) -> dict:
    """
    Update the final_category in expense_categories and record a correction
    in category_corrections for personalised retraining.
    """
    with get_db() as conn:
        pd_row = conn.execute(
            "SELECT pd.*, ec.final_category AS previous_category,"
            "       ec.predicted_category, ec.confidence"
            " FROM purchase_details pd"
            " LEFT JOIN expense_categories ec ON ec.purchase_detail_id = pd.id"
            " WHERE pd.id = ? AND pd.user_id = ?",
            (payload.purchase_detail_id, user_id),
        ).fetchone()
        if not pd_row:
            raise HTTPException(status_code=404, detail="Purchase detail not found.")

        now = datetime.now(timezone.utc).isoformat()
        # Use INSERT OR REPLACE to ensure category is updated even if row doesn't exist
        conn.execute(
            """
            INSERT INTO expense_categories
                (user_id, purchase_detail_id, predicted_category, confidence,
                 final_category, category_source, corrected_at)
            VALUES (?, ?, ?, ?, ?, 'user_correction', ?)
            ON CONFLICT(purchase_detail_id) DO UPDATE SET
                final_category = excluded.final_category,
                category_source = excluded.category_source,
                corrected_at = excluded.corrected_at
            """,
            (user_id, payload.purchase_detail_id,
             pd_row["predicted_category"],  # Preserve existing predicted category
             pd_row["confidence"],  # Preserve existing confidence
             payload.corrected_category, now),
        )

        purchase_time = pd_row["purchase_time"] or ""
        try:
            pt = datetime.fromisoformat(purchase_time[:10])
            p_month   = pt.month
            p_weekday = pt.weekday()
        except (ValueError, TypeError):
            p_month, p_weekday = None, None

        # Find the linked SMS to_who for context
        sms_row = conn.execute(
            """
            SELECT st.to_who FROM sms_transactions st
            JOIN transaction_purchase_matches tpm ON tpm.sms_transaction_id = st.id
            WHERE tpm.purchase_detail_id = ? LIMIT 1
            """,
            (payload.purchase_detail_id,),
        ).fetchone()

        conn.execute(
            """
            INSERT INTO category_corrections
                (user_id, purchase_detail_id, item_name, normalized_item_name,
                 merchant_name, to_who, quantity, unit,
                 unit_cost_rwf, total_cost_rwf,
                 purchase_month, purchase_weekday,
                 previous_category, corrected_category, correction_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')
            """,
            (
                user_id,
                payload.purchase_detail_id,
                pd_row["item_name"],
                pd_row["normalized_item_name"],
                pd_row["merchant_name"],
                sms_row["to_who"] if sms_row else None,
                pd_row["quantity"],
                pd_row["unit"],
                pd_row["unit_cost_rwf"],
                pd_row["total_cost_rwf"],
                p_month, p_weekday,
                pd_row["previous_category"],
                payload.corrected_category,
            ),
        )

        # Count this user's total corrections to decide on auto-trigger
        total_corrections = conn.execute(
            "SELECT COUNT(*) AS count FROM category_corrections WHERE user_id = ?",
            (user_id,),
        ).fetchone()["count"]

    # -- Determine whether to queue retraining --
    # Auto-trigger when corrections reach a multiple of the configured threshold.
    # Manual trigger (payload.trigger_retraining=True) always queues a job.
    # Guard: skip if a job for this user is already queued or running.
    threshold = settings.min_corrections_for_retraining
    auto_trigger = (
        threshold > 0
        and total_corrections > 0
        and total_corrections % threshold == 0
    )
    should_retrain = payload.trigger_retraining or auto_trigger

    if should_retrain:
        with get_db() as conn:
            already_active = conn.execute(
                "SELECT 1 FROM retraining_jobs"
                " WHERE user_id = ? AND model_type = 'expense_category'"
                "   AND status IN ('queued', 'running')",
                (user_id,),
            ).fetchone()
        if already_active:
            return {
                "job_id": "not_started", "status": "saved",
                "message": (
                    "Correction saved. A retraining job is already active; "
                    "skipped duplicate queuing."
                ),
            }
        job_id = create_job(user_id, "expense_category")
        trigger_reason = "manual" if payload.trigger_retraining else f"auto ({total_corrections} corrections)"
        background_tasks.add_task(retrain_category_model, job_id, user_id)
        return {
            "job_id": job_id, "status": "queued",
            "message": f"Correction saved. Category model retraining queued ({trigger_reason}).",
        }

    return {
        "job_id": "not_started", "status": "saved",
        "message": (
            f"Correction saved. "
            f"Retraining will auto-trigger after {threshold - (total_corrections % threshold or threshold)} more correction(s)."
        ),
    }


# --- GET /transactions/export/csv ---

@router.get(
    "/export/csv",
    summary="Export transactions as a CSV file",
    tags=["Transactions"],
)
def export_transactions_csv(
    from_date:        Optional[str] = Query(default=None, description="ISO date (inclusive)"),
    to_date:          Optional[str] = Query(default=None, description="ISO date (inclusive)"),
    transaction_type: Optional[str] = Query(default=None, description="income or expense"),
    user_id:          str           = Depends(get_current_user_id),
):
    """
    Return all matching SMS transactions for the authenticated user as a UTF-8 CSV.
    Columns: date, type, amount_rwf, fee_rwf, to_who, from_who, reference, provider,
             balance_after_rwf, currency, parse_confidence.
    """
    import csv
    import io
    from datetime import datetime as dt
    from fastapi.responses import StreamingResponse

    if transaction_type and transaction_type not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="transaction_type must be 'income' or 'expense'.")
    
    # Validate date format and range
    if from_date:
        try:
            from_dt = dt.fromisoformat(from_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="from_date must be a valid ISO date (YYYY-MM-DD).")
    else:
        from_dt = None
    
    if to_date:
        try:
            to_dt = dt.fromisoformat(to_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="to_date must be a valid ISO date (YYYY-MM-DD).")
    else:
        to_dt = None
    
    # Validate that from_date is not after to_date
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(
            status_code=400,
            detail="from_date cannot be after to_date.",
        )

    conditions = ["user_id = ?"]
    params: list = [user_id]
    if from_date:
        conditions.append("transaction_time >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("transaction_time <= ?")
        params.append(to_date)
    if transaction_type:
        conditions.append("transaction_type = ?")
        params.append(transaction_type)

    where = " AND ".join(conditions)

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT transaction_time, transaction_type, amount_rwf, fee_rwf,
                   to_who, from_who, transaction_reference, provider,
                   balance_after_rwf, currency, parse_confidence
            FROM sms_transactions
            WHERE {where}
            ORDER BY transaction_time DESC
            """,
            params,
        ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "date", "type", "amount_rwf", "fee_rwf", "to_who", "from_who",
        "reference", "provider", "balance_after_rwf", "currency", "parse_confidence",
    ])
    for row in rows:
        writer.writerow([
            row["transaction_time"] or "",
            row["transaction_type"],
            row["amount_rwf"],
            row["fee_rwf"],
            row["to_who"] or "",
            row["from_who"] or "",
            row["transaction_reference"] or "",
            row["provider"] or "",
            row["balance_after_rwf"] if row["balance_after_rwf"] is not None else "",
            row["currency"],
            row["parse_confidence"],
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=smartspend_transactions.csv"},
    )

