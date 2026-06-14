import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.auth import get_current_user_id
from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import ConsentRequiredError
from app.schemas.schemas import ReceiptItem, ReceiptOut, ReceiptSummary
from app.services.ocr_service import (
    extract_text_from_receipt,
    generate_upload_filename,
    parse_receipt_items,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_BYTES = settings.max_upload_size_mb * 1024 * 1024


@router.post(
    "/upload",
    response_model=ReceiptOut,
    status_code=201,
    summary="Upload a receipt image",
)
async def upload_receipt(
    file:              UploadFile = File(..., description="Receipt image (JPEG, PNG, PDF, or WebP)."),
    consent_confirmed: bool       = Form(..., description="Must be true before processing personal data."),
    user_id:           str        = Depends(get_current_user_id),
) -> ReceiptOut:
    """
    Store a receipt image and extract line items via OCR.

    The file is renamed to a UUID-based name to prevent path traversal.
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

    extracted_text, ocr_mode = extract_text_from_receipt(str(target_path))
    raw_items    = parse_receipt_items(extracted_text)
    parsed_items = [
        ReceiptItem(product_name=i["productName"], price=i["price"])
        for i in raw_items
    ]

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO receipts"
            " (user_id, file_path, original_filename, extracted_text, parsed_items_json, ocr_mode)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                user_id,
                str(target_path),   # stored internally only — never returned to client
                file.filename,
                extracted_text,
                json.dumps(raw_items),
                ocr_mode,
            ),
        )
        receipt_id = cursor.lastrowid
        created_row = conn.execute(
            "SELECT created_at FROM receipts WHERE id = ?", (receipt_id,)
        ).fetchone()
        created_at = created_row["created_at"] if created_row else None

    logger.info(
        "Receipt uploaded for user '%s': %d item(s) parsed (mode=%s).",
        user_id, len(parsed_items), ocr_mode,
    )
    return ReceiptOut(
        receipt_id=receipt_id,
        original_filename=file.filename,
        extracted_text=extracted_text,
        parsed_items=parsed_items,
        matched_transaction_id=None,
        ocr_mode=ocr_mode,
        created_at=created_at,
    )


@router.get(
    "/",
    response_model=list[ReceiptSummary],
    summary="List uploaded receipts",
)
def list_receipts(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    """Return a summary list of all receipts uploaded by the current user."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id AS receipt_id, original_filename, ocr_mode,"
            " created_at, matched_transaction_id"
            " FROM receipts WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.get(
    "/{receipt_id}",
    response_model=ReceiptOut,
    summary="Get a single receipt with parsed items",
)
def get_receipt(
    receipt_id: int,
    user_id:    str = Depends(get_current_user_id),
) -> ReceiptOut:
    """Retrieve a receipt with its full extracted text and parsed line items."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM receipts WHERE id = ? AND user_id = ?",
            (receipt_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Receipt not found.")
    data      = dict(row)
    raw_items = json.loads(data.get("parsed_items_json") or "[]")
    return ReceiptOut(
        receipt_id=data["id"],
        original_filename=data.get("original_filename"),
        extracted_text=data.get("extracted_text") or "",
        parsed_items=[
            ReceiptItem(product_name=i["productName"], price=i["price"])
            for i in raw_items
        ],
        matched_transaction_id=data.get("matched_transaction_id"),
        ocr_mode=data.get("ocr_mode", "mock"),
        created_at=data.get("created_at"),
    )
