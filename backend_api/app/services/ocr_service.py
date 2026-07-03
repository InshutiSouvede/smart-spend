"""
OCR service — PaddleOCR-based receipt text extraction and parsing.

Design notes
------------
* PaddleOCR is the primary OCR engine for reliable text extraction
* The PaddleOCR instance is a module-level lazy singleton to avoid
  re-initializing the model on every request
* Large images are resized in-place (max _MAX_OCR_DIMENSION px) before OCR
  to reduce memory and inference time
* File content is validated against magic bytes before being written to disk
"""
import io
import logging
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import ClassVar, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, UnidentifiedImageError

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class OCRLine:
    """A single detected text line with its position and confidence."""

    text: str
    confidence: float
    # 4 corner points: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
    bbox: List[List[float]] = field(default_factory=list)


@dataclass
class OCRResult:
    """Full output of one OCR pass."""

    text: str                   # lines joined by \n, sorted top→bottom/left→right
    lines: List[OCRLine]        # individual detections (confidence >= MIN_LINE_CONF)
    confidence: float           # mean confidence of all raw detections (0–1)

    @property
    def is_empty(self) -> bool:
        return not self.text.strip()


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Lines below this threshold are kept in confidence calculation but excluded
# from the text output (they are likely noise).
_MIN_LINE_CONF = 0.50
# Lines below this are not even included in the confidence average.
_MIN_RAW_CONF = 0.10

# Maximum image side length (pixels) before in-place downscale
_MAX_OCR_DIMENSION = 4096

# Skip keywords for receipt parsing
_SKIP_KEYWORDS = frozenset(
    {
        "total", "subtotal", "tax", "vat", "change", "cash", "receipt",
        "thank", "welcome", "invoice", "date", "time", "tel", "address",
        "tin", "cashier", "served",
    }
)

# ---------------------------------------------------------------------------
# Compiled regexes for receipt parsing (Enhanced patterns from receipt-reader)
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
    r"(?:grand\s*total|total\s*amount|amount\s*due|amount\s*paid|net\s*total|total)"
    r"[^\d]{0,20}([\d,]+(?:\.\d+)?)\s*(?:RWF|frw)?\s*$",
    re.I,
)

# Date/time patterns ordered from most to least specific
_DATE_PATTERNS: List[re.Pattern] = [
    re.compile(r"(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)"),   # 2026-06-13 10:54:00
    re.compile(r"(\d{2}[-/]\d{2}[-/]\d{4}[T ]?\d{2}:\d{2}(?::\d{2})?)"),  # 13/06/2026 10:54
    re.compile(r"(\d{4}[-/]\d{2}[-/]\d{2})"),                               # 2026-06-13
    re.compile(r"(\d{2}[-/]\d{2}[-/]\d{4})"),                               # 13/06/2026
    re.compile(r"(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})"),                        # 1/6/26 or 01/06/2026
]

# Enhanced metadata patterns
_META_KW = re.compile(
    r"\b("
    r"TIN|TVA|VAT|TOTAL|SUBTOTAL|SUB.TOTAL|CASH|CARD|VISA|MASTERCARD|"
    r"MOMO|MTN|AIRTEL|MOBILE|DATE|TIME|INVOICE|RECEIPT|CHANGE|BALANCE|"
    r"AMOUNT.DUE|DISCOUNT|REMISE|THANK|WELCOME|SERVED|CASHIER|TABLE|"
    r"ORDER|TEL|PHONE|ADDRESS|EMAIL|WEBSITE|WWW|HTTP|FAX|FACTURE|"
    r"OPERATOR|TILL|POS|EBM|RRA|PRINTER|SERIAL|SIGNATURE"
    r")\b",
    re.IGNORECASE,
)

# Rwanda Revenue Authority TIN (9-digit) with optional label
_TIN_LABELED = re.compile(r"\bTIN\b[:\s]+(\d{5,15})", re.IGNORECASE)
_TIN_BARE = re.compile(r"(?<!\d)(\d{9})(?!\d)")

# Receipt / Invoice number
_RECEIPT_NO_RE = re.compile(
    r"(?:RECEIPT|INVOICE|FACTURE|NO\.?|NUMBER|REF|#)[:\s#]*([A-Z0-9/_-]{2,20})",
    re.IGNORECASE,
)

# Time pattern
_TIME_RE = re.compile(r"\b(\d{2}:\d{2}(?::\d{2})?)\b")

# Payment method keywords
_PAYMENT_RE = re.compile(
    r"\b(CASH|CARD|VISA|MASTERCARD|MOMO|MTN|AIRTEL|MOBILE.MONEY|CREDIT|DEBIT)\b",
    re.IGNORECASE,
)

# Quantity inline patterns: "2x1000" or "2pcs 1000"
_QTY_INLINE = [
    re.compile(r"(\d+(?:\.\d+)?)\s*[xX@]\s*([\d,]+(?:\.\d+)?)"),  # 2x1000 / 2@1000
    re.compile(
        r"(\d+(?:\.\d+)?)\s*(?:pcs?|units?|nos?)\s+([\d,]+(?:\.\d+)?)",
        re.IGNORECASE,
    ),  # 2pcs 1000
]

# Purely numeric token (no letters)
_PURE_NUMBER = re.compile(r"^[\d,]+(?:\.\d+)?$")

# ---------------------------------------------------------------------------
# Magic-byte map: (leading_bytes, canonical_extension)
# ---------------------------------------------------------------------------
_MAGIC_MAP: List[Tuple[bytes, str]] = [
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG",      ".png"),
    (b"RIFF",         ".webp"),  # also check bytes[8:12] == b"WEBP"
    (b"%PDF",         ".pdf"),
]

# ---------------------------------------------------------------------------
# PaddleOCR singleton service
# ---------------------------------------------------------------------------


class OCRService:
    """Singleton wrapper around PaddleOCR for receipt text extraction."""

    _instance: ClassVar[Optional["OCRService"]] = None
    _engine: Optional[object]

    def __new__(cls) -> "OCRService":
        if cls._instance is None:
            instance = super().__new__(cls)
            instance._engine = None
            cls._instance = instance
        return cls._instance

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract(self, image_bytes: bytes) -> OCRResult:
        """Run OCR and return text, per-line details, and overall confidence."""
        image_array = self._decode_image(image_bytes)
        return self._run_ocr(image_array)

    def extract_text(self, image_bytes: bytes) -> str:
        """Convenience wrapper — returns only the text string."""
        return self.extract(image_bytes).text

    def extract_from_file(self, file_path: str) -> OCRResult:
        """Run OCR on a file path and return OCRResult."""
        with open(file_path, "rb") as f:
            image_bytes = f.read()
        return self.extract(image_bytes)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_engine(self) -> object:
        """Lazy-load PaddleOCR engine (singleton)."""
        if self._engine is None:
            try:
                from paddleocr import PaddleOCR
                logger.info("Initializing PaddleOCR (first call — model download may occur)…")
                self._engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
                logger.info("PaddleOCR ready.")
            except ImportError as exc:
                logger.error(
                    "PaddleOCR not installed. Install with: pip install paddlepaddle paddleocr"
                )
                raise RuntimeError("PaddleOCR is not installed") from exc
        return self._engine

    @staticmethod
    def _decode_image(image_bytes: bytes) -> np.ndarray:
        """Decode image bytes to numpy array."""
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
            if image.mode != "RGB":
                image = image.convert("RGB")
            return np.array(image)
        except UnidentifiedImageError as exc:
            raise ValueError("The file does not appear to be a valid image.") from exc
        except Exception as exc:
            raise ValueError(f"Could not decode image: {exc}") from exc

    def _run_ocr(self, image_array: np.ndarray) -> OCRResult:
        """Run PaddleOCR on image array and return structured result."""
        try:
            engine = self._get_engine()
            raw = engine.ocr(image_array, cls=True)
        except Exception as exc:
            logger.exception("PaddleOCR raised an unexpected error.")
            raise RuntimeError("OCR processing failed.") from exc

        if not raw or not raw[0]:
            return OCRResult(text="", lines=[], confidence=0.0)

        all_confidences: List[float] = []
        detections: List[tuple] = []  # (top_y, left_x, text, confidence, bbox)

        for det in raw[0]:
            if not det or len(det) < 2:
                continue
            bbox, text_info = det[0], det[1]
            if not text_info or len(text_info) < 2:
                continue
            text, conf = str(text_info[0]), float(text_info[1])

            if conf < _MIN_RAW_CONF:
                continue
            all_confidences.append(conf)

            if conf >= _MIN_LINE_CONF:
                top_y = min(pt[1] for pt in bbox)
                left_x = min(pt[0] for pt in bbox)
                detections.append((top_y, left_x, text, conf, bbox))

        # Sort reading order: top→bottom, then left→right
        detections.sort(key=lambda d: (d[0], d[1]))

        lines = [
            OCRLine(text=t, confidence=c, bbox=b)
            for _, _, t, c, b in detections
        ]
        full_text = "\n".join(ln.text for ln in lines)
        overall_conf = float(np.mean(all_confidences)) if all_confidences else 0.0

        return OCRResult(text=full_text, lines=lines, confidence=overall_conf)


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------


def validate_image_magic(content: bytes, allowed_extensions: List[str]) -> None:
    """
    Verify that *content*'s magic bytes correspond to one of the allowed
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
                    f"Detected content type '{ext}' is not in the allowed list "
                    f"({', '.join(sorted(allowed))})."
                )
            return  # valid

    raise ValueError(
        "File content does not match any recognized image format "
        "(JPEG, PNG, WebP, PDF)."
    )


# ---------------------------------------------------------------------------
# Image compression / resizing
# ---------------------------------------------------------------------------


def compress_image_for_ocr(file_path: str) -> None:
    """
    Resize the image at *file_path* **in place** if either dimension exceeds
    ``_MAX_OCR_DIMENSION`` pixels, preserving the original format.

    PDF files are left unchanged.  Any error is logged and silently ignored —
    the original file is then used for OCR as-is.

    Requires Pillow; skips silently if it is not installed.
    """
    path = Path(file_path)
    if path.suffix.lower() == ".pdf":
        return
    try:
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
                "Resized '%s' from %dx%d → %dx%d before OCR.",
                path.name, w, h, *new_size,
            )
    except Exception as exc:
        logger.warning("Could not resize image '%s': %s", file_path, exc)


# ---------------------------------------------------------------------------
# Main OCR entry point (backward compatible)
# ---------------------------------------------------------------------------


def extract_text_from_receipt(file_path: str) -> Tuple[str, str]:
    """
    Extract text from a receipt image and return ``(text, ocr_mode_label)``.

    This function provides backward compatibility with the existing codebase.
    """
    if not settings.paddle_ocr_enabled:
        logger.warning("PaddleOCR is disabled in settings. Enable with PADDLE_OCR_ENABLED=true")
        raise RuntimeError("OCR is disabled")

    try:
        ocr_service = OCRService()
        result = ocr_service.extract_from_file(file_path)
        return result.text, "paddleocr"
    except RuntimeError as exc:
        logger.error("OCR failed for '%s': %s", file_path, exc)
        raise
    except Exception as exc:
        logger.error("Unexpected error during OCR for '%s': %s", file_path, exc)
        raise RuntimeError(f"OCR failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Parsing helper functions (Enhanced from receipt-reader)
# ---------------------------------------------------------------------------


def _parse_amount(s: str) -> Optional[float]:
    """'1,200.50' → 1200.50 | '1200' → 1200.0 | non-numeric → None."""
    cleaned = s.strip().replace(",", "")
    try:
        val = float(cleaned)
        return val if val >= 0 else None
    except ValueError:
        return None


def _normalize_line(line: str) -> str:
    """Collapse tabs/CR, shrink runs of 3+ spaces to two (column separator)."""
    line = re.sub(r"[\t\r]", " ", line)
    line = re.sub(r" {3,}", "  ", line)
    return line.strip()


def _is_metadata(line: str) -> bool:
    """Check if line contains metadata keywords."""
    return bool(_META_KW.search(line))


def _extract_amounts(line: str) -> List[float]:
    """Extract all numeric amounts from a line."""
    amount_re = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\b")
    return [
        v
        for m in amount_re.finditer(line)
        if (v := _parse_amount(m.group(1))) is not None
    ]


# ---------------------------------------------------------------------------
# Receipt header parser — merchant name, total amount, timestamp
# ---------------------------------------------------------------------------


def parse_receipt_header(lines: List[str]) -> Dict:
    """
    Extract receipt-level metadata from OCR *lines*:

    * **merchant_name** — first non-price, non-keyword line (the shop name).
    * **total_amount_rwf** — the number adjacent to a "TOTAL" keyword.
    * **receipt_timestamp** — ISO-8601-like string of the first date/time found.
    * **merchant_tin** — Rwanda TIN (9-digit).
    * **receipt_number** — Receipt or invoice number.
    * **payment_method** — Detected payment method (cash, card, mobile_money).

    Returns a dict with keys ``merchant_name``, ``total_amount_rwf``,
    ``receipt_timestamp``, ``merchant_tin``, ``receipt_number``, 
    ``payment_method``; missing values are ``None``.
    """
    merchant_name: Optional[str] = None
    total_amount_rwf: Optional[float] = None
    receipt_timestamp: Optional[str] = None
    merchant_tin: Optional[str] = None
    receipt_number: Optional[str] = None
    payment_method: str = "unknown"
    
    date_str: Optional[str] = None
    time_str: Optional[str] = None
    header_candidates: List[str] = []

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        
        normalized = _normalize_line(stripped)
        upper = normalized.upper()

        # Total amount (enhanced pattern matching)
        if total_amount_rwf is None:
            # Try grand total variants first (most specific)
            if re.search(
                r"\b(GRAND.TOTAL|TOTAL.RWF|AMOUNT.DUE|TOTAL.AMOUNT|NET.TOTAL)\b", upper
            ):
                amounts = _extract_amounts(normalized)
                if amounts:
                    total_amount_rwf = amounts[-1]
            # Then try plain TOTAL (exclude SUBTOTAL)
            elif re.search(r"\bTOTAL\b", upper) and not re.search(r"\bSUB", upper):
                amounts = _extract_amounts(normalized)
                if amounts:
                    candidate = amounts[-1]
                    if total_amount_rwf is None or candidate > total_amount_rwf:
                        total_amount_rwf = candidate

        # TIN
        if merchant_tin is None:
            m = _TIN_LABELED.search(normalized)
            if m:
                merchant_tin = m.group(1).strip()
            elif "TIN" in upper:
                m2 = _TIN_BARE.search(normalized)
                if m2:
                    merchant_tin = m2.group(1)

        # Receipt / invoice number
        if receipt_number is None:
            m = _RECEIPT_NO_RE.search(normalized)
            if m:
                candidate = m.group(1).strip()
                if candidate.upper() not in ("NO", "NUMBER", "REF"):
                    receipt_number = candidate

        # Date
        if date_str is None:
            for pat in _DATE_PATTERNS:
                m = pat.search(normalized)
                if m:
                    date_str = m.group(1)
                    break

        # Time (skip lines that are purely dates to avoid HH:MM confusion)
        if time_str is None and "DATE" not in upper:
            m = _TIME_RE.search(normalized)
            if m:
                time_str = m.group(1)

        # Payment method
        if payment_method == "unknown":
            m = _PAYMENT_RE.search(normalized)
            if m:
                kw = m.group(1).upper()
                if kw in ("CASH",):
                    payment_method = "cash"
                elif kw in ("CARD", "VISA", "MASTERCARD", "CREDIT", "DEBIT"):
                    payment_method = "card"
                elif kw in ("MOMO", "MTN", "AIRTEL", "MOBILE"):
                    payment_method = "mobile_money"

        # Merchant name candidates: early non-metadata, non-numeric lines
        if idx < 8 and not _is_metadata(normalized):
            amounts = _extract_amounts(normalized)
            if not amounts and len(normalized) >= 3:
                header_candidates.append(normalized)

    # Combine date and time
    if date_str:
        # Standardize date format to YYYY-MM-DD
        date_str = date_str.replace("/", "-")
        receipt_timestamp = (
            f"{date_str} {time_str}" if time_str else date_str
        )

    # Pick the longest header candidate as merchant name
    if header_candidates:
        merchant_name = max(header_candidates, key=len)

    return {
        "merchant_name":     merchant_name,
        "total_amount_rwf":  total_amount_rwf,
        "receipt_timestamp": receipt_timestamp,
        "merchant_tin":      merchant_tin,
        "receipt_number":    receipt_number,
        "payment_method":    payment_method,
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
    Split ``'Rice 5kg'`` → ``('Rice', 5.0, 'kg')``.
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
                    r"^(kg|g|l|ml|pcs?|pieces?|units?|bottles?|packs?)$",
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
    Parse OCR text into item-level purchase detail dicts (Enhanced with better parsing).

    Each dict contains:
        ``item_name``, ``normalized_item_name``, ``quantity``, ``unit``,
        ``unit_cost_rwf``, ``total_cost_rwf``, ``purchase_time``,
        ``merchant_name``, ``extraction_confidence``

    Pass *purchase_time* from :func:`parse_receipt_header` so items inherit
    the receipt timestamp rather than the upload time.
    Lines matching total/summary keywords are excluded.
    
    Enhanced features:
    - Column detection (split on double-spaces)
    - Inline quantity patterns (2x1000, 3pcs 500)
    - Better numeric extraction
    - Discount line detection
    """
    lines = extracted_text.splitlines()
    fallback_time = purchase_time or datetime.now(timezone.utc).isoformat()

    items = []
    for line in lines:
        stripped = line.strip()
        if not stripped or len(stripped) < 3:
            continue
        
        normalized = _normalize_line(stripped)
        
        # Skip metadata lines
        if _is_metadata(normalized):
            continue

        # Try to parse the item
        item = _try_parse_item(normalized)
        if item:
            # Add standard fields
            item["purchase_time"] = fallback_time
            item["merchant_name"] = merchant_name
            item["extraction_confidence"] = 0.85
            items.append(item)

    return items


def _try_parse_item(line: str) -> Optional[dict]:
    """
    Try to parse a single line into an item dict.
    Returns None if the line doesn't look like an item.
    
    Enhanced parsing with multiple strategies:
    1. Discount lines
    2. Inline quantity patterns (2x1000, 3pcs 500)
    3. Column-based parsing (split on double-space)
    4. Fallback single-space split
    """
    # Discount line
    if re.search(r"\b(DISCOUNT|DISC|REBATE|PROMO|REMISE)\b", line, re.IGNORECASE):
        amounts = _extract_amounts(line)
        if amounts:
            return {
                "item_name": line.strip(),
                "normalized_item_name": _normalize_item_name(line.strip()),
                "quantity": 1.0,
                "unit": None,
                "unit_cost_rwf": 0.0,
                "total_cost_rwf": -amounts[-1],  # Negative for discount
            }
        return None

    # Inline quantity pattern: "2x1000 Sugar" or "Sugar 2pcs 1000"
    for pat in _QTY_INLINE:
        m = pat.search(line)
        if m:
            qty = float(m.group(1).replace(",", ""))
            unit_price = _parse_amount(m.group(2)) or 0.0
            total = round(qty * unit_price, 2)
            name = (line[: m.start()] + line[m.end() :]).strip()
            name = re.sub(r"\s+", " ", name) or line.strip()
            
            clean_name, extracted_qty, unit = _parse_qty_unit(name)
            # Use inline quantity, not the one from unit pattern
            
            return {
                "item_name": clean_name,
                "normalized_item_name": _normalize_item_name(clean_name),
                "quantity": qty,
                "unit": unit,
                "unit_cost_rwf": unit_price,
                "total_cost_rwf": total,
            }

    # Split on double-space as column separator first
    parts = re.split(r"\s{2,}", line)
    if len(parts) >= 2:
        numbers: List[float] = []
        name_parts = list(parts)
        
        # Extract numbers from right to left
        while name_parts:
            val = _parse_amount(name_parts[-1])
            if val is not None and _PURE_NUMBER.match(name_parts[-1].strip()):
                numbers.insert(0, val)
                name_parts.pop()
            else:
                break
        
        if numbers and name_parts:
            product_name = "  ".join(name_parts).strip()
            return _build_item_from_numbers(product_name, numbers)

    # Fallback: single-space split, last token as price
    tokens = line.split()
    if len(tokens) >= 2:
        val = _parse_amount(tokens[-1])
        if val is not None and _PURE_NUMBER.match(tokens[-1]):
            product_name = " ".join(tokens[:-1]).strip()
            if re.search(r"[A-Za-z]", product_name):
                return _build_item_from_numbers(product_name, [val])

    return None


def _build_item_from_numbers(product: str, numbers: List[float]) -> Optional[dict]:
    """
    Build an item dict from product name and extracted numbers.
    Handles 1, 2, or 3+ numbers with intelligent interpretation.
    """
    if not product or not numbers:
        return None
    if len(product) < 2 or not re.search(r"[A-Za-z]", product):
        return None

    # Parse quantity/unit from product name
    clean_name, extracted_qty, unit = _parse_qty_unit(product)

    if len(numbers) == 1:
        # Single number: treat as total price
        total = numbers[0]
        # Use extracted quantity if available, else 1.0
        qty = extracted_qty if extracted_qty > 1.0 else 1.0
        unit_price = round(total / qty, 2) if qty > 0 else total
        
        return {
            "item_name": clean_name,
            "normalized_item_name": _normalize_item_name(clean_name),
            "quantity": qty,
            "unit": unit,
            "unit_cost_rwf": unit_price,
            "total_cost_rwf": total,
        }

    if len(numbers) == 2:
        # Two numbers: unit_price and total
        unit_price, total = numbers[0], numbers[1]
        qty = round(total / unit_price, 4) if unit_price > 0 else 1.0
        
        return {
            "item_name": clean_name,
            "normalized_item_name": _normalize_item_name(clean_name),
            "quantity": qty,
            "unit": unit,
            "unit_cost_rwf": unit_price,
            "total_cost_rwf": total,
        }

    # 3+ numbers: treat as qty, unit_price, total
    qty, unit_price, total = numbers[0], numbers[1], numbers[2]
    expected = qty * unit_price
    
    # If validation fails, re-interpret as (unit_price, total), qty inferred
    if total > 0 and abs(expected - total) / total > 0.10:
        qty = round(total / unit_price, 4) if unit_price > 0 else 1.0
    
    return {
        "item_name": clean_name,
        "normalized_item_name": _normalize_item_name(clean_name),
        "quantity": qty,
        "unit": unit,
        "unit_cost_rwf": unit_price,
        "total_cost_rwf": total,
    }


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
