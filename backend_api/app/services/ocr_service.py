import logging
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

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
    {"total", "subtotal", "tax", "vat", "change", "cash", "receipt", "thank", "welcome",
     "invoice", "date", "time", "tel", "address", "tin", "cashier", "served"}
)

# Unit keywords that may appear after a quantity number (e.g. "2 kg", "3L", "500g")
_UNIT_PATTERN = re.compile(
    r"^([\d.]+)\s*(kg|g|l|ml|pcs?|pieces?|units?|bottles?|packs?|bags?|loaves?|rolls?|cans?|litres?|liters?)\b",
    re.I,
)

# Price line: "Some product name    1,200 RWF" or "Product  2,500"
_PRICE_LINE = re.compile(r"^(.+?)\s{2,}([\d,]+(?:\.\d+)?)\s*(?:RWF)?\s*$", re.I)


def _normalize_item_name(name: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_str).strip().lower()


def _parse_qty_unit(raw_name: str) -> Tuple[str, float, Optional[str]]:
    """
    Split a product name token like 'Rice 5kg' into (clean_name, quantity, unit).
    Returns the original name, 1.0, None if no quantity pattern is found.
    """
    tokens = raw_name.split()
    for i, token in enumerate(tokens):
        m = _UNIT_PATTERN.match(token)
        if m:
            qty = float(m.group(1))
            unit = m.group(2).lower()
            clean = " ".join(tokens[:i] + tokens[i + 1:]).strip() or raw_name
            return clean, qty, unit
        # Bare number followed by a unit token
        try:
            qty = float(token.replace(",", ""))
            if i + 1 < len(tokens):
                next_tok = tokens[i + 1].lower()
                if re.match(r"^(kg|g|l|ml|pcs?|pieces?|units?|bottles?|packs?|bags?)$", next_tok):
                    clean = " ".join(tokens[:i] + tokens[i + 2:]).strip() or raw_name
                    return clean, qty, next_tok
        except ValueError:
            pass
    return raw_name, 1.0, None


def _extract_merchant_name(lines: List[str]) -> Optional[str]:
    """
    Heuristic: the merchant name is the first non-empty line that contains
    no price tokens and appears before any item line.
    """
    price_re = re.compile(r"[\d,]+\s*RWF", re.I)
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if any(kw in stripped.lower() for kw in _SKIP_KEYWORDS):
            continue
        if price_re.search(stripped):
            break   # reached item lines — stop looking
        if len(stripped) > 3:
            return stripped
    return None


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


def parse_receipt_items(
    extracted_text: str,
    purchase_time: Optional[str] = None,
) -> List[dict]:
    """
    Parse OCR text into a list of item-level purchase detail dicts.

    Each dict contains:
        item_name, normalized_item_name, quantity, unit,
        unit_cost_rwf, total_cost_rwf, purchase_time, merchant_name

    Lines containing totals or summary keywords are excluded.
    Merchant name is extracted from the receipt header (first non-price line).
    """
    lines = extracted_text.splitlines()
    merchant_name = _extract_merchant_name(lines)
    fallback_time = purchase_time or datetime.now(timezone.utc).isoformat()

    items = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if any(kw in stripped.lower() for kw in _SKIP_KEYWORDS):
            continue

        m = _PRICE_LINE.match(stripped)
        if not m:
            continue

        raw_name = m.group(1).strip()
        try:
            total_cost = float(m.group(2).replace(",", ""))
        except ValueError:
            continue

        if not raw_name or total_cost <= 0:
            continue

        clean_name, quantity, unit = _parse_qty_unit(raw_name)
        unit_cost = round(total_cost / quantity, 2) if quantity > 0 else total_cost

        items.append({
            "item_name":             clean_name,
            "normalized_item_name":  _normalize_item_name(clean_name),
            "quantity":              quantity,
            "unit":                  unit,
            "unit_cost_rwf":         unit_cost,
            "total_cost_rwf":        total_cost,
            "purchase_time":         fallback_time,
            "merchant_name":         merchant_name,
            "extraction_confidence": 0.85,
        })

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
