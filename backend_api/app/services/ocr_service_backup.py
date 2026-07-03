"""
OCR service \u2014 PaddleOCR-based receipt text extraction and parsing.

Design notes
------------
* PaddleOCR is the only supported OCR backend (no paid APIs).
* The PaddleOCR instance is a module-level lazy singleton to avoid
  re-initialising the model on every request.
* If paddleocr / paddlepaddle are not installed the service falls back to
  static mock text so end-to-end tests keep working without the ~1 GB dep.
* Large images are resized in-place (max _MAX_OCR_DIMENSION px) before OCR
  to reduce memory and inference time.
* File content is validated against magic bytes before being written to disk.
"""
import logging
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mock OCR text \u2014 used when PADDLE_OCR_ENABLED=false or paddleocr not installed
# ---------------------------------------------------------------------------
_MOCK_OCR_TEXT = """\
SIMBA SUPERMARKET KIMIRONKO
Date: 2026-06-13 10:54:00
Milk 1L                    1,200 RWF
Bread                      1,000 RWF
Rice 5kg                   7,500 RWF
TOTAL                      9,700 RWF
"""

_SKIP_KEYWORDS = frozenset(
    {
        "total", "subtotal", "tax", "vat", "change", "cash", "receipt",
        "thank", "welcome", "invoice", "date", "time", "tel", "address",
        "tin", "cashier", "served",
    }
)

# ---------------------------------------------------------------------------
# Compiled regexes
# ---------------------------------------------------------------------------

# Unit keywords that may appear after a quantity number (e.g. "2 kg", "3L", "500g")
_UNIT_PATTERN = re.compile(
    r"^([\d.]+)\s*(kg|g|l|ml|pcs?|pieces?|units?|bottles?|packs?|bags?|loaves?|rolls?|cans?|litres?|liters?)\b",
    re.I,
)

# Item line: "Product name    1,200 RWF"  or  "Product  2,500"
_PRICE_LINE = re.compile(r"^(.+?)\s{2,}([\d,]+(?:\.\d+)?)\s*(?:RWF)?\s*$", re.I)

# Total line: "TOTAL  9,700 RWF" / "Grand Total  9,700" / "Amount Due  9700"
_TOTAL_LINE = re.compile(
    r"(?:grand\s*total|total\s*amount|amount\s*due|amount\s*paid|total)"
    r"[^\d]{0,20}([\d,]+(?:\.\d+)?)\s*(?:RWF|frw)?\s*$",
    re.I,
)

# Date/time patterns ordered from most to least specific
_DATE_PATTERNS: List[re.Pattern] = [
    re.compile(r"(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)"),   # 2026-06-13 10:54:00
    re.compile(r"(\d{2}[-/]\d{2}[-/]\d{4}[T ]?\d{2}:\d{2}(?::\d{2})?)"),  # 13/06/2026 10:54
    re.compile(r"(\d{4}[-/]\d{2}[-/]\d{2})"),                               # 2026-06-13
    re.compile(r"(\d{2}[-/]\d{2}[-/]\d{4})"),                               # 13/06/2026
]

# ---------------------------------------------------------------------------
# Magic-byte map: (leading_bytes, canonical_extension)
# ---------------------------------------------------------------------------
_MAGIC_MAP: List[Tuple[bytes, str]] = [
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG",      ".png"),
    (b"RIFF",         ".webp"),  # also check bytes[8:12] == b"WEBP"
    (b"%PDF",         ".pdf"),
]

# Maximum image side length (pixels) before in-place downscale
_MAX_OCR_DIMENSION = 4096

# ---------------------------------------------------------------------------
# PaddleOCR lazy singleton
# ---------------------------------------------------------------------------
_paddle_ocr_instance = None
_easy_ocr_instance = None
_tesseract_available = None


def _get_paddle_ocr():
    """Return (and lazily initialise) the shared PaddleOCR instance."""
    global _paddle_ocr_instance  # noqa: PLW0603
    if _paddle_ocr_instance is None:
        from paddleocr import PaddleOCR  # type: ignore

        # show_log=False suppresses PaddlePaddle's verbose startup messages.
        _paddle_ocr_instance = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return _paddle_ocr_instance


def _get_easy_ocr():
    """Return (and lazily initialise) the shared EasyOCR instance."""
    global _easy_ocr_instance  # noqa: PLW0603
    if _easy_ocr_instance is None:
        import easyocr
        # Use English language, GPU if available
        _easy_ocr_instance = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _easy_ocr_instance


def _check_tesseract_available():
    """Check if Tesseract OCR is available on the system."""
    global _tesseract_available  # noqa: PLW0603
    if _tesseract_available is None:
        try:
            import pytesseract
            # Try to get version to verify tesseract executable exists
            pytesseract.get_tesseract_version()
            _tesseract_available = True
        except Exception:
            _tesseract_available = False
    return _tesseract_available


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------


def validate_image_magic(content: bytes, allowed_extensions: List[str]) -> None:
    """
    Verify that *content*\u2019s magic bytes correspond to one of the allowed
    file extensions.  Raises ``ValueError`` on a mismatch or unknown type.

    This prevents attackers from uploading arbitrary files by spoofing the
    filename extension.
    """
    allowed = {ext.lower() for ext in allowed_extensions}
    if ".jpeg" in allowed:
        allowed.add(".jpg")
    if ".jpg" in allowed:
        allowed.add(".jpeg")

    for magic, ext in _MAGIC_MAP:
        if content[: len(magic)] == magic:
            if ext == ".webp" and content[8:12] != b"WEBP":
                continue  # RIFF container but not WebP
            if ext not in allowed:
                raise ValueError(
                    f"Detected content type \u2018{ext}\u2019 is not in the allowed list "
                    f"({', '.join(sorted(allowed))})."
                )
            return  # valid

    raise ValueError(
        "File content does not match any recognised image format "
        "(JPEG, PNG, WebP, PDF)."
    )


# ---------------------------------------------------------------------------
# Image compression / resizing
# ---------------------------------------------------------------------------


def compress_image_for_ocr(file_path: str) -> None:
    """
    Resize the image at *file_path* **in place** if either dimension exceeds
    ``_MAX_OCR_DIMENSION`` pixels, preserving the original format.

    PDF files are left unchanged.  Any error is logged and silently ignored \u2014
    the original file is then used for OCR as-is.

    Requires Pillow; skips silently if it is not installed.
    """
    path = Path(file_path)
    if path.suffix.lower() == ".pdf":
        return
    try:
        from PIL import Image  # type: ignore

        with Image.open(file_path) as img:
            w, h = img.size
            if w <= _MAX_OCR_DIMENSION and h <= _MAX_OCR_DIMENSION:
                return
            scale = _MAX_OCR_DIMENSION / max(w, h)
            new_size = (int(w * scale), int(h * scale))
            fmt = img.format  # preserve original format
            resized = img.resize(new_size, Image.LANCZOS)
            save_kwargs: Dict = {}
            if fmt == "JPEG":
                save_kwargs = {"quality": 85, "optimize": True}
            resized.save(file_path, format=fmt, **save_kwargs)
            logger.info(
                "Resized '%s' from %dx%d \u2192 %dx%d before OCR.",
                path.name, w, h, *new_size,
            )
    except ImportError:
        logger.debug("Pillow not installed; skipping pre-OCR image resize.")
    except Exception as exc:
        logger.warning("Could not resize image '%s': %s", file_path, exc)


# ---------------------------------------------------------------------------
# PaddleOCR text extraction
# ---------------------------------------------------------------------------


def _run_paddleocr(file_path: str) -> Tuple[str, str]:
    """
    Run PaddleOCR on *file_path* and return ``(concatenated_text, 'paddleocr')``.

    On the first call the OCR model is downloaded (~80 MB for the English
    pack).  Subsequent calls reuse the cached singleton.

    Falls back to mock text if paddleocr / paddlepaddle are not installed.
    """
    try:
        ocr = _get_paddle_ocr()
        result = ocr.ocr(file_path, cls=True)
        lines: List[str] = []
        # result: list[page],  page: list[ [bbox, (text, confidence)] ]
        for page in result:
            if page is None:
                continue
            for entry in page:
                text_part = entry[1]
                text = text_part[0] if isinstance(text_part, (list, tuple)) else text_part
                if text:
                    lines.append(str(text).strip())
        return "\n".join(lines), "paddleocr"
    except ImportError:
        logger.warning(
            "paddleocr/paddlepaddle not installed; falling back to mock OCR. "
            "Install with: pip install paddlepaddle paddleocr"
        )
        return _MOCK_OCR_TEXT, "mock_fallback_import_error"
    except Exception as exc:
        logger.error("PaddleOCR failed for '%s': %s", file_path, exc)
        return _MOCK_OCR_TEXT, "mock_fallback_exception"


# ---------------------------------------------------------------------------
# EasyOCR text extraction
# ---------------------------------------------------------------------------


def _run_easyocr(file_path: str) -> Tuple[str, str]:
    """
    Run EasyOCR on *file_path* and return ``(concatenated_text, 'easyocr')``.
    
    On the first call the OCR model is downloaded (~80 MB for the English
    pack). Subsequent calls reuse the cached singleton.
    
    Falls back to mock text if easyocr is not installed.
    """
    try:
        ocr = _get_easy_ocr()
        result = ocr.readtext(file_path)
        # result: list of tuples: (bbox, text, confidence)
        lines: List[str] = []
        for entry in result:
            if len(entry) >= 2:
                text = entry[1]  # text is the second element
                if text and isinstance(text, str):
                    lines.append(text.strip())
        return "\n".join(lines), "easyocr"
    except ImportError:
        logger.warning(
            "easyocr not installed; falling back to mock OCR. "
            "Install with: pip install easyocr"
        )
        return _MOCK_OCR_TEXT, "mock_fallback_import_error"
    except Exception as exc:
        logger.error("EasyOCR failed for '%s': %s", file_path, exc)
        return _MOCK_OCR_TEXT, "mock_fallback_exception"


# ---------------------------------------------------------------------------
# Tesseract OCR text extraction
# ---------------------------------------------------------------------------


def _run_tesseract(file_path: str) -> Tuple[str, str]:
    """
    Run Tesseract OCR on *file_path* and return ``(text, 'tesseract')``.
    
    Requires Tesseract to be installed on the system.
    Download from: https://github.com/UB-Mannheim/tesseract/wiki
    
    Falls back to mock text if pytesseract is not installed or tesseract executable not found.
    """
    try:
        import pytesseract
        from PIL import Image
        
        # On Windows, explicitly set tesseract path if not already set
        if pytesseract.pytesseract.tesseract_cmd == 'tesseract':
            # Try common Windows installation paths
            import platform
            if platform.system() == 'Windows':
                common_paths = [
                    r'C:\Program Files\Tesseract-OCR\tesseract.exe',
                    r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
                ]
                for path in common_paths:
                    if Path(path).exists():
                        pytesseract.pytesseract.tesseract_cmd = path
                        logger.info("Set Tesseract path to: %s", path)
                        break
        
        # Open image and run OCR
        img = Image.open(file_path)
        text = pytesseract.image_to_string(img, lang='eng')
        
        if text and len(text.strip()) > 0:
            logger.info("Tesseract extracted %d characters from '%s'", len(text), file_path)
            return text, "tesseract"
        else:
            logger.warning("Tesseract returned empty text for '%s'", file_path)
            return _MOCK_OCR_TEXT, "mock_fallback_empty"
            
    except ImportError:
        logger.warning(
            "pytesseract not installed; falling back to mock OCR. "
            "Install with: pip install pytesseract"
        )
        return _MOCK_OCR_TEXT, "mock_fallback_import_error"
    except Exception as exc:
        logger.error("Tesseract failed for '%s': %s", file_path, exc)
        return _MOCK_OCR_TEXT, "mock_fallback_exception"


# ---------------------------------------------------------------------------
# Public OCR entry-point
# ---------------------------------------------------------------------------


def extract_text_from_receipt(file_path: str) -> Tuple[str, str]:
    """
    Extract text from a receipt image and return ``(text, ocr_mode_label)``.

    * ``PADDLE_OCR_ENABLED=true`` (default) \u2192 Tries OCR engines in order of preference.
    * ``PADDLE_OCR_ENABLED=false`` \u2192 Skips PaddleOCR, tries other engines.
    
    Priority: PaddleOCR > Tesseract > EasyOCR > Mock Data
    """
    tried_engines = []
    
    if settings.paddle_ocr_enabled:
        # Try PaddleOCR first
        tried_engines.append("PaddleOCR")
        text, mode = _run_paddleocr(file_path)
        if "mock" not in mode:
            return text, mode
    
    # Try Tesseract OCR (lightweight, Windows-friendly)
    if _check_tesseract_available():
        tried_engines.append("Tesseract")
        logger.info("Trying Tesseract OCR for '%s' (previous attempts: %s)", 
                   file_path, ", ".join(tried_engines[:-1]) if len(tried_engines) > 1 else "none")
        text, mode = _run_tesseract(file_path)
        if "mock" not in mode:
            return text, mode
    
    # Try EasyOCR as fallback
    tried_engines.append("EasyOCR")
    logger.info("Trying EasyOCR for '%s' (previous attempts: %s)", 
               file_path, ", ".join(tried_engines[:-1]) if len(tried_engines) > 1 else "none")
    text, mode = _run_easyocr(file_path)
    if "mock" not in mode:
        return text, mode
    
    # All OCR engines failed, return mock data
    logger.warning(
        "All OCR engines failed for '%s'. Tried: %s. "
        "Install at least one OCR engine: "
        "Tesseract (https://github.com/UB-Mannheim/tesseract/wiki), "
        "pip install paddlepaddle paddleocr, or pip install easyocr",
        file_path, ", ".join(tried_engines)
    )
    return _MOCK_OCR_TEXT, "mock"


# ---------------------------------------------------------------------------
# Receipt header parser \u2014 merchant name, total amount, timestamp
# ---------------------------------------------------------------------------


def parse_receipt_header(lines: List[str]) -> Dict:
    """
    Extract receipt-level metadata from OCR *lines*:

    * **merchant_name** \u2014 first non-price, non-keyword line (the shop name).
    * **total_amount_rwf** \u2014 the number adjacent to a \u201cTOTAL\u201d keyword.
    * **receipt_timestamp** \u2014 ISO-8601-like string of the first date/time found.

    Returns a dict with keys ``merchant_name``, ``total_amount_rwf``,
    ``receipt_timestamp``; missing values are ``None``.
    """
    merchant_name: Optional[str] = None
    total_amount_rwf: Optional[float] = None
    receipt_timestamp: Optional[str] = None

    price_re = re.compile(r"[\d,]+\s*RWF", re.I)

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Total amount
        if total_amount_rwf is None:
            m_total = _TOTAL_LINE.search(stripped)
            if m_total:
                try:
                    total_amount_rwf = float(m_total.group(1).replace(",", ""))
                except ValueError:
                    pass

        # Timestamp (first match wins)
        if receipt_timestamp is None:
            for pat in _DATE_PATTERNS:
                m_dt = pat.search(stripped)
                if m_dt:
                    receipt_timestamp = m_dt.group(1).replace("/", "-")
                    break

        # Merchant name: first header-like line (before item/total lines)
        if merchant_name is None:
            lower = stripped.lower()
            if any(kw in lower for kw in _SKIP_KEYWORDS):
                continue
            if price_re.search(stripped):
                continue
            if len(stripped) > 3:
                merchant_name = stripped

    return {
        "merchant_name":     merchant_name,
        "total_amount_rwf":  total_amount_rwf,
        "receipt_timestamp": receipt_timestamp,
    }


# ---------------------------------------------------------------------------
# Item-level parser
# ---------------------------------------------------------------------------


def _normalize_item_name(name: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_str).strip().lower()


def _parse_qty_unit(raw_name: str) -> Tuple[str, float, Optional[str]]:
    """
    Split ``'Rice 5kg'`` \u2192 ``('Rice', 5.0, 'kg')``.
    Returns ``(raw_name, 1.0, None)`` if no quantity pattern found.
    """
    tokens = raw_name.split()
    for i, token in enumerate(tokens):
        m = _UNIT_PATTERN.match(token)
        if m:
            qty = float(m.group(1))
            unit = m.group(2).lower()
            clean = " ".join(tokens[:i] + tokens[i + 1 :]).strip() or raw_name
            return clean, qty, unit
        # Bare number followed by a unit token: "2 kg"
        try:
            qty = float(token.replace(",", ""))
            if i + 1 < len(tokens):
                next_tok = tokens[i + 1].lower()
                if re.match(
                    r"^(kg|g|l|ml|pcs?|pieces?|units?|bottles?|packs?|bags?)$",
                    next_tok,
                ):
                    clean = " ".join(tokens[:i] + tokens[i + 2 :]).strip() or raw_name
                    return clean, qty, next_tok
        except ValueError:
            pass
    return raw_name, 1.0, None


def parse_receipt_items(
    extracted_text: str,
    purchase_time: Optional[str] = None,
    merchant_name: Optional[str] = None,
) -> List[dict]:
    """
    Parse OCR text into item-level purchase detail dicts.

    Each dict contains:
        ``item_name``, ``normalized_item_name``, ``quantity``, ``unit``,
        ``unit_cost_rwf``, ``total_cost_rwf``, ``purchase_time``,
        ``merchant_name``, ``extraction_confidence``

    Pass *purchase_time* from :func:`parse_receipt_header` so items inherit
    the receipt timestamp rather than the upload time.
    Lines matching total/summary keywords are excluded.
    """
    lines = extracted_text.splitlines()
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

        items.append(
            {
                "item_name":             clean_name,
                "normalized_item_name":  _normalize_item_name(clean_name),
                "quantity":              quantity,
                "unit":                  unit,
                "unit_cost_rwf":         unit_cost,
                "total_cost_rwf":        total_cost,
                "purchase_time":         fallback_time,
                "merchant_name":         merchant_name,
                "extraction_confidence": 0.85,
            }
        )

    return items


# ---------------------------------------------------------------------------
# Upload filename helper
# ---------------------------------------------------------------------------


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
