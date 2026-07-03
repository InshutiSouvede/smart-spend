"""receipt_validator.py — Validate a parsed Receipt for structural consistency.

Validation is a lightweight post-processing step that:
  1. Checks numeric consistency (totals, quantities, prices).
  2. Verifies date format.
  3. Scores how complete the receipt data is (parser_confidence).

On failure it returns warnings rather than raising, so the pipeline can
decide whether to retry or return the best result found so far.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2}(?::\d{2})?)?$"
)

_TOL = 0.10  # 10 % tolerance for float comparisons


@dataclass
class ValidationResult:
    is_valid: bool
    warnings: List[str] = field(default_factory=list)
    confidence: float = 0.0


class ReceiptValidator:
    """Validate a Receipt and produce a confidence score."""

    def validate(self, receipt_data: Dict[str, Any]) -> ValidationResult:
        """Validate a receipt dictionary and return validation result.
        
        Args:
            receipt_data: Dictionary containing receipt fields like:
                - merchant_name
                - total_amount_rwf
                - receipt_timestamp
                - items (list of dicts with product, quantity, unit_price, total)
        
        Returns:
            ValidationResult with is_valid, warnings, and confidence score
        """
        warnings: List[str] = []

        # ── Completeness checks ──────────────────────────────────────────────
        score = self._completeness_score(receipt_data)

        # ── Date format ──────────────────────────────────────────────────────
        ts = receipt_data.get("receipt_timestamp")
        if ts and not _DATE_RE.match(str(ts).strip()):
            warnings.append(
                f"receipt_timestamp '{ts}' does not match YYYY-MM-DD [HH:MM:SS]."
            )

        # ── Item-level sanity ────────────────────────────────────────────────
        items = receipt_data.get("items", [])
        for idx, item in enumerate(items):
            product = item.get("product", f"Item {idx+1}")
            quantity = item.get("quantity")
            unit_price = item.get("unit_price")
            total_amount = item.get("total_amount")
            
            if quantity is not None and quantity <= 0:
                warnings.append(
                    f"Item '{product}' has non-positive quantity ({quantity})."
                )
            if unit_price is not None and unit_price < 0:
                warnings.append(
                    f"Item '{product}' has negative unit_price ({unit_price})."
                )
            if (
                quantity is not None
                and unit_price is not None
                and total_amount is not None
                and total_amount > 0
            ):
                expected = quantity * unit_price
                if not _approx(expected, total_amount, _TOL):
                    warnings.append(
                        f"Item '{product}': "
                        f"{quantity} × {unit_price} ≠ {total_amount}."
                    )

        # ── Totals consistency ───────────────────────────────────────────────
        total = receipt_data.get("total_amount_rwf")
        
        if items and total is not None and total > 0:
            items_sum = sum(
                (item.get("total_amount") or 0)
                for item in items
            )
            if items_sum > 0 and not _approx(items_sum, total, _TOL):
                warnings.append(
                    f"Sum of item totals ({items_sum:.2f}) does not match "
                    f"total_amount_rwf ({total})."
                )

        is_valid = True  # No critical errors for now, just warnings
        return ValidationResult(
            is_valid=is_valid,
            warnings=warnings,
            confidence=round(min(score, 1.0), 3),
        )

    # ------------------------------------------------------------------
    # Confidence / completeness scoring
    # ------------------------------------------------------------------

    @staticmethod
    def _completeness_score(r: Dict[str, Any]) -> float:
        """Calculate completeness score (0-1) based on fields present."""
        score = 0.0
        
        if r.get("merchant_name"):
            score += 0.15
        if r.get("receipt_timestamp"):
            score += 0.15
        if r.get("items"):
            score += 0.20
            # Extra credit for items with full detail
            items = r.get("items", [])
            complete_items = sum(
                1
                for i in items
                if i.get("unit_price") is not None and i.get("total_amount") is not None
            )
            if items:
                score += 0.15 * (complete_items / len(items))
        if r.get("total_amount_rwf") is not None and r.get("total_amount_rwf", 0) > 0:
            score += 0.25
        
        # Optional fields
        if r.get("ocr_raw_text"):
            score += 0.05
        if r.get("file_path"):
            score += 0.05
        
        return score


def _approx(a: float, b: float, tol: float) -> bool:
    """Check if two floats are approximately equal within tolerance."""
    if b == 0:
        return abs(a) < 1
    return abs(a - b) / abs(b) <= tol
