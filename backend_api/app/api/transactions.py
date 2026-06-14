import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from app.core.auth import get_current_user_id
from app.core.database import get_db
from app.core.exceptions import ConsentRequiredError
from app.schemas.schemas import (
    CorrectionRequest,
    RetrainResponse,
    SMSIngestRequest,
    TransactionCategoryUpdate,
    TransactionListResponse,
    TransactionOut,
)
from app.services.model_service import model_service
from app.services.retraining_service import create_job, retrain_category_model
from app.services.sms_parser import Direction, parse_momo_sms

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/sms/sync",
    response_model=list[TransactionOut],
    summary="Parse and store MoMo SMS messages",
)
def sync_sms(
    payload: SMSIngestRequest,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """
    Parse a batch of raw MTN MoMo or Airtel Money SMS messages and persist
    them as structured transaction records.

    Outgoing transactions are passed through the ML categorisation model.
    Incoming transactions are labelled using their resolved transaction type.
    """
    if not payload.consent_confirmed:
        raise ConsentRequiredError()

    created: list[dict] = []

    with get_db() as conn:
        for raw in payload.raw_sms_messages:
            parsed = parse_momo_sms(raw)

            if parsed.direction == Direction.OUTGOING:
                cat_result = model_service.categorize(user_id, parsed.description)
                category   = cat_result["category"]
                confidence = cat_result["confidence"]
            else:
                category   = parsed.transaction_type
                confidence = 1.0

            cursor = conn.execute(
                """
                INSERT INTO transactions (
                    user_id, raw_sms, transaction_type, direction,
                    amount_rwf, fee_rwf, total_amount_rwf, balance_after_rwf,
                    currency, counterpart, description,
                    category, confidence, timestamp, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    parsed.raw_sms,
                    parsed.transaction_type,
                    parsed.direction,
                    parsed.amount_rwf,
                    parsed.fee_rwf,
                    parsed.total_amount_rwf,
                    parsed.balance_after_rwf,
                    parsed.currency,
                    parsed.counterpart_name,
                    parsed.description,
                    category,
                    confidence,
                    parsed.timestamp,
                    "sms",
                ),
            )
            created.append(
                {
                    "id":               cursor.lastrowid,
                    "transaction_type": parsed.transaction_type,
                    "direction":        parsed.direction,
                    "amount_rwf":       parsed.amount_rwf,
                    "fee_rwf":          parsed.fee_rwf,
                    "total_amount_rwf": parsed.total_amount_rwf,
                    "balance_after_rwf": parsed.balance_after_rwf,
                    "currency":         parsed.currency,
                    "counterpart":      parsed.counterpart_name,
                    "description":      parsed.description,
                    "category":         category,
                    "confidence":       confidence,
                    "timestamp":        parsed.timestamp,
                    "source":           "sms",
                    "created_at":       None,
                }
            )

    logger.info("Synced %d SMS(es) for user '%s'.", len(created), user_id)
    return created


@router.get(
    "/",
    response_model=TransactionListResponse,
    summary="List transactions with filtering and pagination",
)
def list_transactions(
    page:       int            = Query(default=1,    ge=1),
    page_size:  int            = Query(default=50,   ge=1, le=200),
    direction:  Optional[str]  = Query(default=None, description="INCOMING or OUTGOING"),
    category:   Optional[str]  = Query(default=None),
    from_date:  Optional[str]  = Query(default=None, description="ISO date string (inclusive)"),
    to_date:    Optional[str]  = Query(default=None, description="ISO date string (inclusive)"),
    user_id:    str            = Depends(get_current_user_id),
) -> dict:
    conditions: list[str] = ["user_id = ?"]
    params: list = [user_id]

    if direction:
        conditions.append("direction = ?")
        params.append(direction.upper())
    if category:
        conditions.append("category = ?")
        params.append(category)
    if from_date:
        conditions.append("timestamp >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("timestamp <= ?")
        params.append(to_date)

    where  = " AND ".join(conditions)
    offset = (page - 1) * page_size

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM transactions WHERE {where}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"SELECT * FROM transactions WHERE {where}"
            f" ORDER BY timestamp DESC, created_at DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()

    return {
        "items":     [dict(r) for r in rows],
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "has_next":  (page * page_size) < total,
    }


@router.get(
    "/{transaction_id}",
    response_model=TransactionOut,
    summary="Get a single transaction by ID",
)
def get_transaction(
    transaction_id: int,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
            (transaction_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return dict(row)


@router.patch(
    "/{transaction_id}/category",
    response_model=TransactionOut,
    summary="Update the category of a transaction",
)
def update_transaction_category(
    transaction_id:   int,
    payload:          TransactionCategoryUpdate,
    background_tasks: BackgroundTasks,
    user_id:          str = Depends(get_current_user_id),
) -> dict:
    """
    Update the category of an existing transaction inline (e.g. from the
    transaction detail screen) and optionally queue a personalised retraining job.

    This also saves a correction record so the retraining pipeline can learn
    from the change.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
            (transaction_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transaction not found.")

        previous_category = row["category"]

        conn.execute(
            "UPDATE transactions SET category = ?, confidence = 1.0"
            " WHERE id = ? AND user_id = ?",
            (payload.category, transaction_id, user_id),
        )
        conn.execute(
            "INSERT INTO category_corrections"
            " (user_id, transaction_id, description, previous_category, corrected_category)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                user_id,
                transaction_id,
                row["description"],
                previous_category,
                payload.category,
            ),
        )
        updated_row = conn.execute(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
            (transaction_id, user_id),
        ).fetchone()

    if payload.trigger_retraining:
        job_id = create_job(user_id, "category")
        background_tasks.add_task(retrain_category_model, job_id, user_id)
        logger.info(
            "Category updated for tx %d (user '%s'): '%s' → '%s'. Retraining queued as job %s.",
            transaction_id, user_id, previous_category, payload.category, job_id,
        )

    return dict(updated_row)


@router.post(
    "/corrections",
    response_model=RetrainResponse,
    summary="Submit a category correction",
)
def add_correction(
    payload:          CorrectionRequest,
    background_tasks: BackgroundTasks,
    user_id:          str = Depends(get_current_user_id),
) -> dict:
    """
    Save a user-provided category correction and optionally queue
    a background personalised retraining job.
    """
    with get_db() as conn:
        conn.execute(
            "INSERT INTO category_corrections"
            " (user_id, transaction_id, description, previous_category, corrected_category)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                user_id,
                payload.transaction_id,
                payload.description,
                payload.previous_category,
                payload.corrected_category,
            ),
        )

    if payload.trigger_retraining:
        job_id = create_job(user_id, "category")
        background_tasks.add_task(retrain_category_model, job_id, user_id)
        return {
            "job_id":  job_id,
            "status":  "queued",
            "message": "Correction saved. Personalised category retraining queued.",
        }

    return {
        "job_id":  "not_started",
        "status":  "saved",
        "message": "Correction saved. Retraining was not triggered.",
    }
