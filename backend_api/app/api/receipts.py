"""
Receipt API \u2014 upload, OCR, parsing, and SMS-transaction matching.

Matching algorithm
------------------
Receipts are matched to expense SMS transactions at the receipt-total level
(not per line item).  A weighted confidence score is computed:

  score = 0.50 \u00d7 amount_score
        + 0.35 \u00d7 time_score
        + 0.15 \u00d7 merchant_score

  amount_score  : 1 \u2212 diff_ratio / tolerance (0 when diff \u2265 tolerance)
  time_score    : 1 \u2212 seconds_diff / time_window (0.5 when either ts missing)
  merchant_score: token-overlap ratio (0.5 when either name missing)

Safe defaults (configurable via .env):
  RECEIPT_MATCH_AMOUNT_TOLERANCE=0.10  (10 % max amount difference)
  RECEIPT_MATCH_TIME_WINDOW_SECONDS=7200  (2-hour proximity window \u2192 score = 0)
  RECEIPT_MATCH_MIN_CONFIDENCE=0.65  (below this threshold: no auto-match)

A receipt is never auto-matched if the candidate SMS is already claimed by
another confirmed receipt.  Each receipt may be linked to at most one SMS
transaction.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.core.auth import get_current_user_id
from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import ConsentRequiredError
from app.schemas.schemas import (
    PurchaseDetailOut,
    ReceiptLinkRequest,
    ReceiptListResponse,
    ReceiptManualLinkOut,
    ReceiptMatchOut,
    ReceiptSummary,
    ReceiptUploadOut,
)
from app.services.model_service import run_category_prediction
from app.services.ocr_service import (
    compress_image_for_ocr,
    extract_text_from_receipt,
    generate_upload_filename,
    parse_receipt_header,
    parse_receipt_items,
    validate_image_magic,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_BYTES = settings.max_upload_size_mb * 1024 * 1024

# ---------------------------------------------------------------------------
# Matching helpers
# ---------------------------------------------------------------------------


def _compute_match_confidence(
    receipt_total: float,
    receipt_ts: str | None,
    receipt_merchant: str | None,
    sms_amount: float,
    sms_ts: str | None,
    sms_to_who: str | None,
) -> float:
    """
    Return a weighted confidence score in [0.0, 1.0] for a receipt \u2194 SMS pair.

    Returns 0.0 immediately when the fractional amount difference exceeds
    ``settings.receipt_match_amount_tolerance`` (hard gate).
    """
    tolerance = settings.receipt_match_amount_tolerance
    time_window = settings.receipt_match_time_window_seconds

    # \u2014\u2014 Amount score (hard-reject gate) \u2014\u2014
    max_amt = max(receipt_total, sms_amount, 1.0)
    diff_ratio = abs(receipt_total - sms_amount) / max_amt
    if diff_ratio >= tolerance:
        return 0.0
    amount_score = 1.0 - diff_ratio / tolerance

    # \u2014\u2014 Time score \u2014\u2014
    if receipt_ts and sms_ts:
        try:
            def _aware(s: str) -> datetime:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

            diff_s = abs((_aware(receipt_ts) - _aware(sms_ts)).total_seconds())
            time_score = max(0.0, 1.0 - diff_s / time_window)
        except (ValueError, TypeError):
            time_score = 0.5  # unknown / unparseable timestamp \u2192 neutral
    else:
        time_score = 0.5  # at least one timestamp missing \u2192 neutral

    # \u2014\u2014 Merchant score \u2014\u2014
    if receipt_merchant and sms_to_who:
        m_tok = set(receipt_merchant.lower().split())
        s_tok = set(sms_to_who.lower().split())
        if m_tok and s_tok:
            merchant_score = len(m_tok & s_tok) / max(len(m_tok), len(s_tok))
        else:
            merchant_score = 0.0
    else:
        merchant_score = 0.5  # at least one name missing \u2192 neutral

    return round(0.50 * amount_score + 0.35 * time_score + 0.15 * merchant_score, 4)


def _find_best_sms_match(
    conn,
    user_id: str,
    receipt_total: float,
    receipt_ts: str | None,
    receipt_merchant: str | None,
) -> tuple[int | None, float]:
    """
    Scan expense SMS transactions and return ``(sms_id, confidence)`` for the
    best candidate above the minimum confidence threshold.

    Pre-filter: amounts within 2\u00d7 tolerance (to limit Python-side scoring).
    Returns ``(None, best_raw_score)`` when no candidate clears the threshold,
    so the caller can log what score the best candidate achieved.
    """
    pre_filter = settings.receipt_match_amount_tolerance * 2
    rows = conn.execute(
        """
        SELECT id, amount_rwf, transaction_time, to_who
        FROM sms_transactions
        WHERE user_id = ?
          AND transaction_type = 'expense'
          AND ABS(amount_rwf - ?) / MAX(?, 1) <= ?
        ORDER BY ABS(amount_rwf - ?)
        LIMIT 20
        """,
        (user_id, receipt_total, receipt_total, pre_filter, receipt_total),
    ).fetchall()

    best_id: int | None = None
    best_score: float = 0.0

    for row in rows:
        score = _compute_match_confidence(
            receipt_total=receipt_total,
            receipt_ts=receipt_ts,
            receipt_merchant=receipt_merchant,
            sms_amount=float(row["amount_rwf"]),
            sms_ts=row["transaction_time"],
            sms_to_who=row["to_who"],
        )
        if score > best_score:
            best_score = score
            best_id = row["id"]

    if best_score < settings.receipt_match_min_confidence:
        return None, best_score
    return best_id, best_score


def _is_sms_claimed(conn, user_id: str, sms_id: int) -> bool:
    """Return True if *sms_id* is already matched to a confirmed receipt."""
    row = conn.execute(
        """
        SELECT id FROM receipt_uploads
        WHERE user_id = ? AND matched_sms_id = ?
          AND match_status IN ('auto_matched', 'user_confirmed')
        """,
        (user_id, sms_id),
    ).fetchone()
    return row is not None


def _link_items_to_sms(
    conn,
    user_id: str,
    sms_id: int,
    pd_ids: list[int],
    score: float,
    matched_by: str = "system",
) -> None:
    """Insert ``transaction_purchase_matches`` rows linking each item to the SMS."""
    status = "auto_matched" if matched_by == "system" else "user_confirmed"
    for pd_id in pd_ids:
        conn.execute(
            """
            INSERT OR IGNORE INTO transaction_purchase_matches
                (user_id, sms_transaction_id, purchase_detail_id,
                 match_status, match_score, matched_by)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, sms_id, pd_id, status, score, matched_by),
        )


def _unlink_receipt(conn, user_id: str, receipt_id: int) -> None:
    """Remove all transaction_purchase_matches rows for a receipt's items."""
    conn.execute(
        """
        DELETE FROM transaction_purchase_matches
        WHERE user_id = ?
          AND purchase_detail_id IN (
              SELECT id FROM purchase_details
              WHERE source_type = 'receipt' AND source_id = ? AND user_id = ?
          )
        """,
        (user_id, receipt_id, user_id),
    )
    conn.execute(
        """
        UPDATE receipt_uploads
           SET matched_sms_id = NULL, match_confidence = NULL,
               match_status = 'unmatched'
         WHERE id = ? AND user_id = ?
        """,
        (receipt_id, user_id),
    )


def _pd_ids_for_receipt(conn, user_id: str, receipt_id: int) -> list[int]:
    rows = conn.execute(
        "SELECT id FROM purchase_details WHERE source_type = 'receipt'"
        "  AND source_id = ? AND user_id = ?",
        (receipt_id, user_id),
    ).fetchall()
    return [r["id"] for r in rows]


def _build_pd_out(rows) -> list[PurchaseDetailOut]:
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
                category_confidence=row_dict.get("category_confidence"),
                created_at=row_dict.get("created_at"),
            )
        )
    return result


_RECEIPT_SUMMARY_SQL = """
    SELECT
        ru.id AS receipt_id,
        ru.ocr_status,
        ru.extraction_status,
        ru.merchant_name,
        ru.total_amount_rwf,
        ru.receipt_timestamp,
        COALESCE(ru.match_status, 'unmatched') AS match_status,
        ru.match_confidence,
        ru.matched_sms_id,
        ru.uploaded_at,
        COUNT(pd.id) AS item_count
    FROM receipt_uploads ru
    LEFT JOIN purchase_details pd
        ON pd.source_type = 'receipt' AND pd.source_id = ru.id
    WHERE ru.user_id = ?
"""

# ---------------------------------------------------------------------------
# Upload endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/upload",
    response_model=ReceiptUploadOut,
    status_code=201,
    summary="Upload a receipt image and extract purchase details",
)
async def upload_receipt(
    file: UploadFile = File(..., description="Receipt image (JPEG, PNG, WebP, or PDF)."),
    consent_confirmed: bool = Form(..., description="Must be true before processing personal data."),
    user_id: str = Depends(get_current_user_id),
) -> ReceiptUploadOut:
    """
    Store a receipt image, validate its content, extract item-level purchase
    details via PaddleOCR, match the receipt total against existing expense SMS
    transactions, and predict a category for each line item.

    The server-side file path is never returned to the client.
    See module docstring for matching thresholds.
    """
    if not consent_confirmed:
        raise ConsentRequiredError()

    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {settings.max_upload_size_mb} MB.",
        )

    # Magic-byte content validation (prevents extension-spoofing uploads)
    try:
        validate_image_magic(content, settings.allowed_upload_extensions)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc))

    user_dir = Path(settings.upload_dir) / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    safe_name = generate_upload_filename(file.filename or "receipt.bin")
    target_path = user_dir / safe_name
    target_path.write_bytes(content)

    # Resize large images in-place to speed up OCR and reduce storage
    compress_image_for_ocr(str(target_path))

    now = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO receipt_uploads (user_id, file_path, ocr_status, extraction_status, uploaded_at)"
            " VALUES (?, ?, 'processing', 'processing', ?)",
            (user_id, str(target_path), now),
        )
        receipt_id = cur.lastrowid

        # \u2014\u2014 OCR \u2014\u2014
        try:
            extracted_text, ocr_mode = extract_text_from_receipt(str(target_path))
            conn.execute(
                "UPDATE receipt_uploads SET ocr_raw_text = ?, ocr_status = 'done' WHERE id = ?",
                (extracted_text, receipt_id),
            )
        except Exception as exc:
            conn.execute(
                "UPDATE receipt_uploads"
                "   SET ocr_status = 'failed', extraction_status = 'failed'"
                " WHERE id = ?",
                (receipt_id,),
            )
            logger.error("OCR failed for receipt %d: %s", receipt_id, exc)
            return ReceiptUploadOut(
                receipt_id=receipt_id,
                ocr_status="failed",
                extraction_status="failed",
                uploaded_at=now,
            )

        # \u2014\u2014 Parse receipt header (merchant, total, timestamp) \u2014\u2014
        lines = extracted_text.splitlines()
        header = parse_receipt_header(lines)
        merchant_name    = header["merchant_name"]
        total_amount_rwf = header["total_amount_rwf"]
        receipt_ts       = header["receipt_timestamp"]

        conn.execute(
            """
            UPDATE receipt_uploads
               SET merchant_name = ?, total_amount_rwf = ?, receipt_timestamp = ?
             WHERE id = ?
            """,
            (merchant_name, total_amount_rwf, receipt_ts, receipt_id),
        )

        # \u2014\u2014 Parse line items \u2014\u2014
        raw_items = parse_receipt_items(
            extracted_text,
            purchase_time=receipt_ts,
            merchant_name=merchant_name,
        )

        if not raw_items:
            conn.execute(
                "UPDATE receipt_uploads"
                "   SET extraction_status = 'no_items', processed_at = ?"
                " WHERE id = ?",
                (now, receipt_id),
            )
            return ReceiptUploadOut(
                receipt_id=receipt_id,
                ocr_status="done",
                ocr_mode=ocr_mode,
                merchant_name=merchant_name,
                total_amount_rwf=total_amount_rwf,
                receipt_timestamp=receipt_ts,
                extraction_status="no_items",
                purchase_details=[],
                uploaded_at=now,
            )

        # \u2014\u2014 Insert purchase_details \u2014\u2014
        pd_ids: list[int] = []
        for item in raw_items:
            pd_cur = conn.execute(
                """
                INSERT INTO purchase_details
                    (user_id, source_type, source_id, purchase_time, merchant_name,
                     item_name, normalized_item_name, quantity, unit,
                     unit_cost_rwf, total_cost_rwf, extraction_confidence)
                VALUES (?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id, receipt_id,
                    item.get("purchase_time"),
                    item.get("merchant_name"),
                    item["item_name"],
                    item.get("normalized_item_name"),
                    item.get("quantity", 1.0),
                    item.get("unit"),
                    item.get("unit_cost_rwf"),
                    item["total_cost_rwf"],
                    item.get("extraction_confidence", 0.85),
                ),
            )
            pd_ids.append(pd_cur.lastrowid)

        # \u2014\u2014 Category prediction per item \u2014\u2014
        for item, pd_id in zip(raw_items, pd_ids):
            try:
                pt_str = item.get("purchase_time")
                pt = datetime.fromisoformat(pt_str[:10]) if pt_str else datetime.now()
            except (ValueError, TypeError):
                pt = datetime.now()
            run_category_prediction(
                user_id,
                pd_id,
                {
                    "item_name":            item["item_name"],
                    "normalized_item_name": item.get("normalized_item_name"),
                    "merchant_name":        item.get("merchant_name"),
                    "to_who":               None,
                    "quantity":             item.get("quantity", 1.0),
                    "unit_cost_rwf":        item.get("unit_cost_rwf") or 0.0,
                    "total_cost_rwf":       float(item["total_cost_rwf"]),
                    "purchase_month":       pt.month,
                    "purchase_weekday":     pt.weekday(),
                },
                conn,
            )

        # \u2014\u2014 Receipt-level SMS matching \u2014\u2014
        # Use the explicit receipt total; fall back to sum of items if absent.
        match_total = total_amount_rwf
        if match_total is None and raw_items:
            match_total = sum(float(it["total_cost_rwf"]) for it in raw_items)

        match_obj: ReceiptMatchOut | None = None

        if match_total is not None and match_total > 0:
            sms_id, confidence = _find_best_sms_match(
                conn, user_id, match_total, receipt_ts, merchant_name
            )
            if sms_id is not None:
                if _is_sms_claimed(conn, user_id, sms_id):
                    logger.info(
                        "Receipt %d: best SMS candidate %d (score=%.3f) already "
                        "claimed by another receipt \u2014 left unmatched.",
                        receipt_id, sms_id, confidence,
                    )
                else:
                    conn.execute(
                        """
                        UPDATE receipt_uploads
                           SET matched_sms_id = ?, match_confidence = ?,
                               match_status = 'auto_matched'
                         WHERE id = ?
                        """,
                        (sms_id, confidence, receipt_id),
                    )
                    _link_items_to_sms(conn, user_id, sms_id, pd_ids, confidence)
                    match_obj = ReceiptMatchOut(
                        matched_sms_id=sms_id,
                        match_confidence=confidence,
                        match_status="auto_matched",
                    )
                    logger.info(
                        "Receipt %d auto-matched to SMS %d (confidence=%.3f).",
                        receipt_id, sms_id, confidence,
                    )
            else:
                logger.info(
                    "Receipt %d: best candidate score %.3f below threshold %.2f \u2014 "
                    "left unmatched.",
                    receipt_id, confidence, settings.receipt_match_min_confidence,
                )

        conn.execute(
            "UPDATE receipt_uploads"
            "   SET extraction_status = 'done', processed_at = ?"
            " WHERE id = ?",
            (now, receipt_id),
        )

    # \u2014\u2014 Build response \u2014\u2014
    with get_db() as conn:
        pd_rows = conn.execute(
            """
            SELECT pd.*, ec.predicted_category, ec.final_category,
                   ec.confidence AS category_confidence
            FROM purchase_details pd
            LEFT JOIN expense_categories ec ON ec.purchase_detail_id = pd.id
            WHERE pd.id IN ({})
            ORDER BY pd.id
            """.format(",".join("?" * len(pd_ids))),
            pd_ids,
        ).fetchall()

    logger.info(
        "Receipt %d: %d item(s) extracted for user '%s'.", receipt_id, len(pd_rows), user_id
    )
    return ReceiptUploadOut(
        receipt_id=receipt_id,
        ocr_status="done",
        ocr_mode=ocr_mode,
        merchant_name=merchant_name,
        total_amount_rwf=total_amount_rwf,
        receipt_timestamp=receipt_ts,
        match=match_obj,
        extraction_status="done",
        purchase_details=_build_pd_out(pd_rows),
        uploaded_at=now,
    )


# ---------------------------------------------------------------------------
# List receipts
# ---------------------------------------------------------------------------


@router.get(
    "/",
    response_model=ReceiptListResponse,
    summary="List uploaded receipts",
)
def list_receipts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user_id: str = Depends(get_current_user_id),
) -> ReceiptListResponse:
    """Return a paginated summary of all receipts uploaded by the current user."""
    offset = (page - 1) * page_size
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM receipt_uploads WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]

        rows = conn.execute(
            _RECEIPT_SUMMARY_SQL + " GROUP BY ru.id ORDER BY ru.uploaded_at DESC LIMIT ? OFFSET ?",
            (user_id, page_size, offset),
        ).fetchall()

    return ReceiptListResponse(
        items=[ReceiptSummary(**dict(r)) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(offset + page_size) < total,
    )


# ---------------------------------------------------------------------------
# List unmatched receipts
# ---------------------------------------------------------------------------


@router.get(
    "/unmatched",
    response_model=ReceiptListResponse,
    summary="List receipts not yet matched to an SMS transaction",
)
def list_unmatched_receipts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user_id: str = Depends(get_current_user_id),
) -> ReceiptListResponse:
    """
    Return receipts whose ``match_status`` is ``'unmatched'`` (or NULL on old
    rows).  These are available for manual linking.
    """
    offset = (page - 1) * page_size
    extra = " AND (ru.match_status = 'unmatched' OR ru.match_status IS NULL)"
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM receipt_uploads WHERE user_id = ?"
            " AND (match_status = 'unmatched' OR match_status IS NULL)",
            (user_id,),
        ).fetchone()[0]

        rows = conn.execute(
            _RECEIPT_SUMMARY_SQL + extra
            + " GROUP BY ru.id ORDER BY ru.uploaded_at DESC LIMIT ? OFFSET ?",
            (user_id, page_size, offset),
        ).fetchall()

    return ReceiptListResponse(
        items=[ReceiptSummary(**dict(r)) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(offset + page_size) < total,
    )


# ---------------------------------------------------------------------------
# Get single receipt
# ---------------------------------------------------------------------------


@router.get(
    "/{receipt_id}",
    response_model=ReceiptUploadOut,
    summary="Get a receipt with its extracted purchase details",
)
def get_receipt(
    receipt_id: int,
    user_id: str = Depends(get_current_user_id),
) -> ReceiptUploadOut:
    """Retrieve a receipt and the full list of extracted purchase details."""
    with get_db() as conn:
        ru = conn.execute(
            "SELECT * FROM receipt_uploads WHERE id = ? AND user_id = ?",
            (receipt_id, user_id),
        ).fetchone()
        if not ru:
            raise HTTPException(status_code=404, detail="Receipt not found.")

        pd_rows = conn.execute(
            """
            SELECT pd.*, ec.predicted_category, ec.final_category,
                   ec.confidence AS category_confidence
            FROM purchase_details pd
            LEFT JOIN expense_categories ec ON ec.purchase_detail_id = pd.id
            WHERE pd.source_type = 'receipt' AND pd.source_id = ? AND pd.user_id = ?
            ORDER BY pd.id
            """,
            (receipt_id, user_id),
        ).fetchall()

    match_obj: ReceiptMatchOut | None = None
    if ru["matched_sms_id"] is not None:
        match_obj = ReceiptMatchOut(
            matched_sms_id=ru["matched_sms_id"],
            match_confidence=ru["match_confidence"],
            match_status=ru["match_status"] or "unmatched",
        )

    return ReceiptUploadOut(
        receipt_id=receipt_id,
        ocr_status=ru["ocr_status"],
        extraction_status=ru["extraction_status"],
        merchant_name=ru["merchant_name"],
        total_amount_rwf=ru["total_amount_rwf"],
        receipt_timestamp=ru["receipt_timestamp"],
        match=match_obj,
        purchase_details=_build_pd_out(pd_rows),
        uploaded_at=ru["uploaded_at"],
    )


# ---------------------------------------------------------------------------
# Manual link / unlink
# ---------------------------------------------------------------------------


@router.post(
    "/{receipt_id}/link",
    response_model=ReceiptManualLinkOut,
    summary="Manually link a receipt to an SMS expense transaction",
)
def link_receipt_to_sms(
    receipt_id: int,
    body: ReceiptLinkRequest,
    user_id: str = Depends(get_current_user_id),
) -> ReceiptManualLinkOut:
    """
    Manually associate an unmatched (or previously rejected) receipt with a
    specific expense SMS transaction.

    * The SMS must belong to the same user and be of type ``'expense'``.
    * If the SMS is already claimed by another confirmed receipt, the request
      is rejected with HTTP 409.
    * This operation recomputes the confidence score for informational purposes
      but always sets ``match_status = 'user_confirmed'``.
    """
    sms_id = body.sms_transaction_id

    with get_db() as conn:
        # Validate receipt
        ru = conn.execute(
            "SELECT * FROM receipt_uploads WHERE id = ? AND user_id = ?",
            (receipt_id, user_id),
        ).fetchone()
        if not ru:
            raise HTTPException(status_code=404, detail="Receipt not found.")

        # Validate SMS
        sms = conn.execute(
            "SELECT id, amount_rwf, transaction_time, to_who FROM sms_transactions"
            " WHERE id = ? AND user_id = ? AND transaction_type = 'expense'",
            (sms_id, user_id),
        ).fetchone()
        if not sms:
            raise HTTPException(
                status_code=404,
                detail="Expense SMS transaction not found.",
            )

        # Guard: SMS already matched to a *different* receipt
        existing = conn.execute(
            "SELECT id FROM receipt_uploads"
            " WHERE user_id = ? AND matched_sms_id = ?"
            "   AND match_status IN ('auto_matched', 'user_confirmed')"
            "   AND id != ?",
            (user_id, sms_id, receipt_id),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"SMS transaction {sms_id} is already matched to "
                    f"receipt {existing['id']}. Unlink it first."
                ),
            )

        # Remove old links for this receipt (if any)
        _unlink_receipt(conn, user_id, receipt_id)

        # Compute informational confidence score
        match_total = ru["total_amount_rwf"]
        pd_ids = _pd_ids_for_receipt(conn, user_id, receipt_id)
        if match_total is None and pd_ids:
            row = conn.execute(
                "SELECT SUM(total_cost_rwf) FROM purchase_details WHERE id IN ({})".format(
                    ",".join("?" * len(pd_ids))
                ),
                pd_ids,
            ).fetchone()
            match_total = row[0] if row and row[0] else None

        confidence: float | None = None
        if match_total is not None and match_total > 0:
            confidence = _compute_match_confidence(
                receipt_total=match_total,
                receipt_ts=ru["receipt_timestamp"],
                receipt_merchant=ru["merchant_name"],
                sms_amount=float(sms["amount_rwf"]),
                sms_ts=sms["transaction_time"],
                sms_to_who=sms["to_who"],
            )

        # Write match
        conn.execute(
            """
            UPDATE receipt_uploads
               SET matched_sms_id = ?, match_confidence = ?,
                   match_status = 'user_confirmed'
             WHERE id = ? AND user_id = ?
            """,
            (sms_id, confidence, receipt_id, user_id),
        )
        if pd_ids:
            _link_items_to_sms(conn, user_id, sms_id, pd_ids, confidence or 0.0, "user")

    logger.info(
        "Receipt %d manually linked to SMS %d by user '%s' (score=%.3f).",
        receipt_id, sms_id, user_id, confidence or 0.0,
    )
    return ReceiptManualLinkOut(
        receipt_id=receipt_id,
        sms_transaction_id=sms_id,
        match_confidence=confidence,
        match_status="user_confirmed",
    )


@router.delete(
    "/{receipt_id}/link",
    status_code=204,
    summary="Remove the match between a receipt and its linked SMS transaction",
)
def unlink_receipt(
    receipt_id: int,
    user_id: str = Depends(get_current_user_id),
) -> None:
    """
    Clear the receipt\u2019s SMS match.  The receipt returns to ``match_status =
    'unmatched'`` and its line items are de-linked from the SMS.  Both the
    receipt record and the SMS transaction are preserved for traceability.
    """
    with get_db() as conn:
        ru = conn.execute(
            "SELECT id FROM receipt_uploads WHERE id = ? AND user_id = ?",
            (receipt_id, user_id),
        ).fetchone()
        if not ru:
            raise HTTPException(status_code=404, detail="Receipt not found.")
        _unlink_receipt(conn, user_id, receipt_id)

    logger.info("Receipt %d unlinked by user '%s'.", receipt_id, user_id)


@router.delete(
    "/{receipt_id}",
    status_code=204,
    summary="Delete a receipt and all associated data",
)
def delete_receipt(
    receipt_id: int,
    user_id: str = Depends(get_current_user_id),
) -> None:
    """
    Permanently delete a receipt, including:
    * Receipt metadata from receipt_uploads table
    * Associated purchase details
    * Transaction-purchase match links
    * The uploaded file (if it exists)
    
    This action cannot be undone.
    """
    with get_db() as conn:
        # Check receipt exists
        ru = conn.execute(
            "SELECT id, file_path FROM receipt_uploads WHERE id = ? AND user_id = ?",
            (receipt_id, user_id),
        ).fetchone()
        if not ru:
            raise HTTPException(status_code=404, detail="Receipt not found.")
        
        file_path = ru["file_path"]
        
        # Delete purchase details and their matches
        conn.execute(
            """
            DELETE FROM transaction_purchase_matches
            WHERE user_id = ? AND purchase_detail_id IN (
                SELECT id FROM purchase_details
                WHERE source_type = 'receipt' AND source_id = ? AND user_id = ?
            )
            """,
            (user_id, receipt_id, user_id),
        )
        
        conn.execute(
            """
            DELETE FROM expense_categories
            WHERE user_id = ? AND purchase_detail_id IN (
                SELECT id FROM purchase_details
                WHERE source_type = 'receipt' AND source_id = ? AND user_id = ?
            )
            """,
            (user_id, receipt_id, user_id),
        )
        
        conn.execute(
            "DELETE FROM purchase_details WHERE source_type = 'receipt' AND source_id = ? AND user_id = ?",
            (receipt_id, user_id),
        )
        
        # Delete receipt record
        conn.execute(
            "DELETE FROM receipt_uploads WHERE id = ? AND user_id = ?",
            (receipt_id, user_id),
        )
    
    # Delete physical file (if it exists)
    if file_path:
        try:
            file_obj = Path(file_path)
            if file_obj.exists():
                file_obj.unlink()
                logger.info("Deleted receipt file: %s", file_path)
        except Exception as exc:
            logger.warning("Could not delete receipt file '%s': %s", file_path, exc)
    
    logger.info("Receipt %d deleted by user '%s'.", receipt_id, user_id)


