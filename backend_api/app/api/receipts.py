import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.core.auth import get_current_user_id
from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import ConsentRequiredError
from app.schemas.schemas import PurchaseDetailOut, ReceiptListResponse, ReceiptSummary, ReceiptUploadOut
from app.services.model_service import model_service, run_category_prediction
from app.services.ocr_service import (
    extract_text_from_receipt,
    generate_upload_filename,
    parse_receipt_items,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_BYTES = settings.max_upload_size_mb * 1024 * 1024


def _try_auto_match_receipt(conn, user_id: str, total_rwf: float,
                             purchase_time: str | None) -> list[int]:
    """Find candidate expense SMS transactions for a receipt purchase."""
    if not purchase_time:
        return []
    rows = conn.execute(
        """
        SELECT id FROM sms_transactions
        WHERE user_id = ?
          AND transaction_type = 'expense'
          AND ABS(CAST(strftime('%s', transaction_time) AS REAL)
               -  CAST(strftime('%s', ?) AS REAL)) <= 7200
          AND ABS(amount_rwf - ?) / MAX(?, 1) <= 0.10
        LIMIT 5
        """,
        (user_id, purchase_time, total_rwf, total_rwf),
    ).fetchall()
    return [r["id"] for r in rows]


@router.post(
    "/upload",
    response_model=ReceiptUploadOut,
    status_code=201,
    summary="Upload a receipt image and extract purchase details",
)
async def upload_receipt(
    file:              UploadFile = File(..., description="Receipt image (JPEG, PNG, PDF, or WebP)."),
    consent_confirmed: bool       = Form(..., description="Must be true before processing personal data."),
    user_id:           str        = Depends(get_current_user_id),
) -> ReceiptUploadOut:
    """
    Store a receipt image, extract item-level purchase details via OCR,
    attempt to match to existing expense SMS transactions, and predict
    a category for each item.

    The server-side file path is never returned to the client.
    """
    if not consent_confirmed:
        raise ConsentRequiredError()

    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {settings.max_upload_size_mb} MB.",
        )

    user_dir = Path(settings.upload_dir) / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    safe_name   = generate_upload_filename(file.filename or "receipt.bin")
    target_path = user_dir / safe_name
    target_path.write_bytes(content)

    now = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        # Insert receipt_uploads row immediately (status = processing)
        cur = conn.execute(
            "INSERT INTO receipt_uploads (user_id, file_path, ocr_status, extraction_status, uploaded_at)"
            " VALUES (?, ?, 'processing', 'processing', ?)",
            (user_id, str(target_path), now),
        )
        receipt_id = cur.lastrowid

        # Run OCR
        try:
            extracted_text, ocr_mode = extract_text_from_receipt(str(target_path))
            conn.execute(
                "UPDATE receipt_uploads SET ocr_raw_text = ?, ocr_status = ? WHERE id = ?",
                (extracted_text, "done", receipt_id),
            )
        except Exception as exc:
            conn.execute(
                "UPDATE receipt_uploads SET ocr_status = 'failed' WHERE id = ?", (receipt_id,)
            )
            logger.error("OCR failed for receipt %d: %s", receipt_id, exc)
            return ReceiptUploadOut(
                receipt_id=receipt_id,
                ocr_status="failed",
                extraction_status="failed",
                uploaded_at=now,
            )

        # Parse items from OCR text
        raw_items = parse_receipt_items(extracted_text)
        if not raw_items:
            conn.execute(
                "UPDATE receipt_uploads SET extraction_status = 'no_items', processed_at = ? WHERE id = ?",
                (now, receipt_id),
            )
            return ReceiptUploadOut(
                receipt_id=receipt_id,
                ocr_status="done",
                ocr_mode=ocr_mode,
                extraction_status="no_items",
                purchase_details=[],
                uploaded_at=now,
            )

        pd_ids: list[int] = []
        for item in raw_items:
            purchase_time = item.get("purchase_time")
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
                    purchase_time,
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
            pd_id = pd_cur.lastrowid
            pd_ids.append(pd_id)

            # Attempt to match to expense SMS
            total = float(item["total_cost_rwf"])
            sms_candidates = _try_auto_match_receipt(conn, user_id, total, purchase_time)
            for sms_id in sms_candidates:
                conn.execute(
                    "INSERT OR IGNORE INTO transaction_purchase_matches"
                    " (user_id, sms_transaction_id, purchase_detail_id,"
                    "  match_status, matched_by)"
                    " VALUES (?, ?, ?, 'auto_matched', 'system')",
                    (user_id, sms_id, pd_id),
                )

            # Category prediction
            try:
                pt = datetime.fromisoformat(purchase_time[:10]) if purchase_time else datetime.now()
            except (ValueError, TypeError):
                pt = datetime.now()

            features = {
                "item_name":             item["item_name"],
                "normalized_item_name":  item.get("normalized_item_name"),
                "merchant_name":         item.get("merchant_name"),
                "to_who":                None,
                "quantity":              item.get("quantity", 1.0),
                "unit_cost_rwf":         item.get("unit_cost_rwf") or 0.0,
                "total_cost_rwf":        total,
                "purchase_month":        pt.month,
                "purchase_weekday":      pt.weekday(),
            }
            run_category_prediction(user_id, pd_id, features, conn)

        conn.execute(
            "UPDATE receipt_uploads SET extraction_status = 'done', processed_at = ? WHERE id = ?",
            (now, receipt_id),
        )

    # Build response
    with get_db() as conn:
        pd_rows = conn.execute(
            """
            SELECT pd.*, ec.predicted_category, ec.final_category, ec.confidence AS category_confidence
            FROM purchase_details pd
            LEFT JOIN expense_categories ec ON ec.purchase_detail_id = pd.id
            WHERE pd.id IN ({})
            ORDER BY pd.id
            """.format(",".join("?" * len(pd_ids))),
            pd_ids,
        ).fetchall()

    details = [
        PurchaseDetailOut(
            id=r["id"],
            source_type=r["source_type"],
            item_name=r["item_name"],
            normalized_item_name=r.get("normalized_item_name"),
            quantity=r.get("quantity", 1.0),
            unit=r.get("unit"),
            unit_cost_rwf=r.get("unit_cost_rwf"),
            total_cost_rwf=r["total_cost_rwf"],
            merchant_name=r.get("merchant_name"),
            purchase_time=r.get("purchase_time"),
            predicted_category=r.get("predicted_category"),
            final_category=r.get("final_category"),
            category_confidence=r.get("category_confidence"),
            created_at=r.get("created_at"),
        )
        for r in pd_rows
    ]

    logger.info(
        "Receipt %d: %d item(s) extracted for user '%s'.", receipt_id, len(details), user_id
    )
    return ReceiptUploadOut(
        receipt_id=receipt_id,
        ocr_status="done",
        ocr_mode=ocr_mode,
        extraction_status="done",
        purchase_details=details,
        uploaded_at=now,
    )


@router.get(
    "/",
    response_model=ReceiptListResponse,
    summary="List uploaded receipts",
)
def list_receipts(
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user_id:   str = Depends(get_current_user_id),
) -> ReceiptListResponse:
    """Return a paginated summary list of all receipts uploaded by the current user."""
    offset = (page - 1) * page_size
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM receipt_uploads WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]

        rows = conn.execute(
            """
            SELECT ru.id AS receipt_id, ru.ocr_status, ru.extraction_status, ru.uploaded_at,
                   COUNT(pd.id) AS item_count
            FROM receipt_uploads ru
            LEFT JOIN purchase_details pd
                ON pd.source_type = 'receipt' AND pd.source_id = ru.id
            WHERE ru.user_id = ?
            GROUP BY ru.id
            ORDER BY ru.uploaded_at DESC
            LIMIT ? OFFSET ?
            """,
            (user_id, page_size, offset),
        ).fetchall()

    return ReceiptListResponse(
        items=[ReceiptSummary(**dict(r)) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(offset + page_size) < total,
    )


@router.get(
    "/{receipt_id}",
    response_model=ReceiptUploadOut,
    summary="Get a receipt with its extracted purchase details",
)
def get_receipt(
    receipt_id: int,
    user_id:    str = Depends(get_current_user_id),
) -> ReceiptUploadOut:
    """Retrieve a receipt and the full list of extracted purchase_details rows."""
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

    details = [
        PurchaseDetailOut(
            id=r["id"],
            source_type=r["source_type"],
            item_name=r["item_name"],
            normalized_item_name=r.get("normalized_item_name"),
            quantity=r.get("quantity", 1.0),
            unit=r.get("unit"),
            unit_cost_rwf=r.get("unit_cost_rwf"),
            total_cost_rwf=r["total_cost_rwf"],
            merchant_name=r.get("merchant_name"),
            purchase_time=r.get("purchase_time"),
            predicted_category=r.get("predicted_category"),
            final_category=r.get("final_category"),
            category_confidence=r.get("category_confidence"),
            created_at=r.get("created_at"),
        )
        for r in pd_rows
    ]

    return ReceiptUploadOut(
        receipt_id=receipt_id,
        ocr_status=ru["ocr_status"],
        extraction_status=ru["extraction_status"],
        purchase_details=details,
        uploaded_at=ru["uploaded_at"],
    )

