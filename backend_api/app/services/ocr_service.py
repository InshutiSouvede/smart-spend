import logging
import re
import uuid
from pathlib import Path
from typing import List, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

_MOCK_OCR_TEXT = """\
SIMBA SUPERMARKET KIMIRONKO
Milk 1L                    1,200 RWF
Bread                      1,000 RWF
Rice 5kg                   7,500 RWF
TOTAL                      9,700 RWF
"""

_SKIP_KEYWORDS = frozenset(
    {"total", "subtotal", "tax", "vat", "change", "cash", "receipt", "thank", "welcome"}
)


def extract_text_from_receipt(file_path: str) -> Tuple[str, str]:
    """
    Extract text from a receipt image and return (text, ocr_mode_label).

    When GOOGLE_VISION_ENABLED=true, calls Google Cloud Vision API.
    Otherwise, returns static mock text to allow end-to-end testing
    without consuming OCR quota.
    """
    if settings.google_vision_enabled:
        return _call_google_vision(file_path)
    return _MOCK_OCR_TEXT, "mock"


def _call_google_vision(file_path: str) -> Tuple[str, str]:
    try:
        from google.cloud import vision  # type: ignore

        client = vision.ImageAnnotatorClient()
        with open(file_path, "rb") as f:
            content = f.read()
        image = vision.Image(content=content)
        response = client.text_detection(image=image)
        if response.error.message:
            logger.error("Google Vision error: %s", response.error.message)
            return _MOCK_OCR_TEXT, "mock_fallback_vision_error"
        return response.full_text_annotation.text, "google_vision"
    except ImportError:
        logger.warning("google-cloud-vision is not installed; using mock OCR.")
        return _MOCK_OCR_TEXT, "mock_fallback_import_error"
    except Exception as exc:
        logger.error("Google Vision call failed: %s", exc)
        return _MOCK_OCR_TEXT, "mock_fallback_exception"


def parse_receipt_items(extracted_text: str) -> List[dict]:
    """
    Parse OCR text into a list of {productName, price} objects using
    positional rules and regex to locate price tokens adjacent to product names.
    Lines containing totals or summary keywords are excluded.
    """
    items = []
    price_re = re.compile(r"^(.+?)\s+([\d,]+)\s*(?:RWF)?$", re.I)

    for line in extracted_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if any(kw in stripped.lower() for kw in _SKIP_KEYWORDS):
            continue
        m = price_re.match(stripped)
        if m:
            product_name = m.group(1).strip()
            try:
                price = float(m.group(2).replace(",", ""))
                if product_name and price > 0:
                    items.append({"productName": product_name, "price": price})
            except ValueError:
                continue
    return items


def generate_upload_filename(original_filename: str) -> str:
    """
    Generate a UUID-based filename to prevent path traversal and collisions.
    The original file extension is preserved only if it is in the allowed list.
    """
    suffix = Path(original_filename).suffix.lower()
    allowed = {ext.lower() for ext in settings.allowed_upload_extensions}
    if suffix not in allowed:
        suffix = ".bin"
    return f"{uuid.uuid4().hex}{suffix}"
