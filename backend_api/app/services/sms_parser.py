"""
Mobile Money SMS Parser for SmartSpend.

Supports MTN Mobile Money and Airtel Money Rwanda SMS formats.
To add support for a new SMS format, implement a new _try_* function
and register it in the _PARSERS list in priority order.
"""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, List, Optional


# --- Result dataclass ---

@dataclass
class ParsedTransaction:
    raw_sms_text:          str
    raw_sms_hash:          str        # SHA-256 of raw_sms_text for deduplication
    sms_time:              str        # when SMS was received (ISO-8601 UTC)
    transaction_time:      str        # when transaction occurred (ISO-8601 UTC)
    transaction_type:      str        # 'income' or 'expense' or 'unknown' (parse failure)
    amount_rwf:            float
    fee_rwf:               float
    balance_after_rwf:     Optional[float]
    to_who:                Optional[str]   # counterpart for expense transactions
    from_who:              Optional[str]   # counterpart for income transactions
    transaction_reference: Optional[str]  # MM/FT/TxId reference for deduplication
    parse_confidence:      float
    # Fields with defaults must come last
    provider:              Optional[str] = None   # 'MTN' or 'Airtel' or None
    currency:              str = "RWF"
    sensitive_flags:       List[str] = field(default_factory=list)


# --- Sensitive keyword detection ---

# Keywords that hint at authentication or security-sensitive content.
# Messages containing any of these should be flagged for user review and
# NOT stored or processed automatically.
SENSITIVE_KEYWORDS: List[str] = [
    "passcode",
    "password",
    " pin ",
    "your pin",
    "enter pin",
    "otp",
    "one-time",
    "one time",
    "verification code",
    "security code",
    "authentication code",
    "temporary code",
    "reset code",
    "don't share",
    "do not share",
    "never share",
    "2fa",
    "two-factor",
]


def detect_sensitive_flags(text: str) -> List[str]:
    """
    Scan SMS text for sensitive keyword hints.

    Returns a list of matched keyword strings (lower-cased).  An empty list
    means the message contains no recognised sensitive terms.
    """
    lower = text.lower()
    return [kw for kw in SENSITIVE_KEYWORDS if kw in lower]


# ─── Provider detection ────────────────────────────────────────────────────────

_RE_MTN_SENDER  = re.compile(r"\bm[.-]?money\b|\bmtn\b", re.I)
_RE_MTN_TEXT    = re.compile(r"\*16[45]\*|Y'ello", re.I)
_RE_AIRTEL      = re.compile(r"\bairtel\b|\bairteltigo\b", re.I)


def _detect_provider(sender: Optional[str], text: str) -> Optional[str]:
    """Infer the mobile money provider from the sender name and/or SMS text."""
    combined = f"{sender or ''} {text}"
    if _RE_MTN_SENDER.search(combined) or _RE_MTN_TEXT.search(combined):
        return "MTN"
    if _RE_AIRTEL.search(combined):
        return "Airtel"
    return None


# --- Shared helper functions ---

def _to_float(s: str) -> float:
    return float(s.replace(",", "").strip())


def _compute_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _extract_fee(text: str) -> float:
    m = re.search(r"[Ff]ee[:\s]+([0-9][0-9,]*)\s*(?:RWF)?", text)
    return _to_float(m.group(1)) if m else 0.0


def _extract_transaction_reference(text: str) -> Optional[str]:
    """Extract the canonical transaction reference (MM/FT/TxId) from an SMS."""
    patterns = [
        r"\bTxId[:\s]*([A-Za-z0-9]+)",          # TxId:12345
        r"\bTransaction\s+([A-Z]{2}[\d]+)",       # Transaction MM100141
        r"\bTx\s+([A-Z]{2}[\d]+)",               # Tx MM101557
        r"\bRef\s+([A-Z]{2}[\d]+)",              # Ref MM101712
        r"\bFT\s*Id[:\s]*([A-Za-z0-9]+)",        # FT Id: 99988
        r"\b([A-Z]{2}[\d]{6,})\b",               # bare MM100141 style
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return None


def _extract_balance(text: str) -> Optional[float]:
    m = re.search(r"[Bb]alance[:\s]+([\d,]+)\s*(?:RWF)?", text)
    return _to_float(m.group(1)) if m else None


def _extract_datetime(text: str) -> str:
    """Extract transaction datetime from SMS text; falls back to current UTC time."""
    m = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})", text)
    if m:
        try:
            dt = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
            return dt.isoformat()
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Parser implementations ---
# Each function receives the raw SMS text and returns a ParsedTransaction
# or None if the pattern does not match.

# MTN MoMo — system/operator merchant debit
# Example: *164*S*Y'ello, A transaction of 1000 RWF by MTN RWANDACELL LIMITED was completed at 2026-06-13 17:37:43...
_RE_MTN_MERCHANT_SYSTEM = re.compile(
    r"transaction\s+of\s+([\d,]+)\s*RWF\s+by\s+(.+?)\s+was\s+completed\s+at\s+"
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.I | re.DOTALL,
)


def _try_mtn_merchant_system(text: str) -> Optional[ParsedTransaction]:
    m = _RE_MTN_MERCHANT_SYSTEM.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    fee = _extract_fee(text)
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="expense",
        amount_rwf=amount,
        fee_rwf=fee,
        balance_after_rwf=_extract_balance(text),
        to_who=counterpart,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# MTN MoMo — explicit merchant payment
# Example: TxId:xxxx*S*Your payment of 2,000 RWF to BAJ Ltd 1341964 was completed at 2026-06-13 10:54:42...
_RE_MTN_MERCHANT_EXPLICIT = re.compile(
    r"[Yy]our\s+payment\s+of\s+([\d,]+)\s*RWF\s+to\s+(.+?)\s+was\s+completed\s+at\s+"
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.I | re.DOTALL,
)


def _try_mtn_merchant_explicit(text: str) -> Optional[ParsedTransaction]:
    m = _RE_MTN_MERCHANT_EXPLICIT.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    fee = _extract_fee(text)
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="expense",
        amount_rwf=amount,
        fee_rwf=fee,
        balance_after_rwf=_extract_balance(text),
        to_who=counterpart,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# MTN MoMo — peer transfer to another MoMo user
# Example: *165*S*500 RWF transferred to Valens HAGENIMANA (250789671799) at 2026-06-12 20:41:38...
_RE_MTN_PEER_TRANSFER = re.compile(
    r"([\d,]+)\s*RWF\s+transferred\s+to\s+([A-Za-z][^(]+?)\s*\([\d]+\)\s+at\s+"
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.I | re.DOTALL,
)


def _try_mtn_peer_transfer(text: str) -> Optional[ParsedTransaction]:
    m = _RE_MTN_PEER_TRANSFER.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    fee = _extract_fee(text)
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="expense",
        amount_rwf=amount,
        fee_rwf=fee,
        balance_after_rwf=_extract_balance(text),
        to_who=counterpart,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# MTN MoMo — cash withdrawal via agent
# Example: You have via agent: Donatien SIBOMANA (*****626), withdrawn 10000 RWF at 2026-05-14 19:52:22...
_RE_MTN_CASH_WITHDRAWAL = re.compile(
    r"via\s+agent[:\s]+(.+?)\s*\([*\d]+\),?\s+withdrawn\s+([\d,]+)\s*RWF\s+at\s+"
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.I | re.DOTALL,
)


def _try_mtn_cash_withdrawal(text: str) -> Optional[ParsedTransaction]:
    m = _RE_MTN_CASH_WITHDRAWAL.search(text)
    if not m:
        return None
    counterpart = m.group(1).strip().rstrip(".")
    amount = _to_float(m.group(2))
    fee = _extract_fee(text)
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="expense",
        amount_rwf=amount,
        fee_rwf=fee,
        balance_after_rwf=_extract_balance(text),
        to_who=counterpart,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# MTN MoMo — money received (peer transfer or bank B2C)
# Example: You have received 5000 RWF from Prosper HAGENIMANA (*****502) at 2026-05-31 21:29:39...
# Example: You have received 20000 RWF from ... Message from sender: Transfer from ...-... Equity B2C.
_RE_MTN_RECEIVED = re.compile(
    r"[Yy]ou\s+have\s+received\s+([\d,]+)\s*RWF\s+from\s+([^(]+?)\s*\([*\d]+\)\s+at\s+"
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.I | re.DOTALL,
)
# B2C keywords indicate the source is a bank disbursement, not an individual peer
_RE_B2C = re.compile(
    r"\bB2C\b|\bEquity\b|\bKCB\b|\bBPR\b|\bBank\s+of\s+Kigali\b|\bBK\b"
    r"|\bCogebanque\b|\bEcobank\b|\bI\&M\b|\bGTBank\b",
    re.I,
)


def _try_mtn_received(text: str) -> Optional[ParsedTransaction]:
    m = _RE_MTN_RECEIVED.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="income",
        amount_rwf=amount,
        fee_rwf=0.0,
        balance_after_rwf=_extract_balance(text),
        to_who=None,
        from_who=counterpart,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )



# MTN MoMo — transfer to bank account (inferred format)
# Inferred from MTN transfer patterns: "Your transfer of X RWF to BANK account..."
_RE_MTN_BANK_TRANSFER_OUT = re.compile(
    r"[Yy]our\s+transfer\s+of\s+([\d,]+)\s*RWF\s+to\s+(.+?)\s+"
    r"(?:account|bank)\b.+?(?:completed\s+at|at)\s+"
    r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.I | re.DOTALL,
)


def _try_mtn_bank_transfer_out(text: str) -> Optional[ParsedTransaction]:
    m = _RE_MTN_BANK_TRANSFER_OUT.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    fee = _extract_fee(text)
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="expense",
        amount_rwf=amount,
        fee_rwf=fee,
        balance_after_rwf=_extract_balance(text),
        to_who=counterpart,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# Airtel Money — money sent
# Inferred format: "Confirmed. You have sent X RWF to NAME on YYYY-MM-DD..."
_RE_AIRTEL_SENT = re.compile(
    r"[Yy]ou\s+(?:have\s+)?sent\s+([\d,]+)\s*RWF\s+to\s+([^on\d]+?)\s+on\s+"
    r"(\d{4}-\d{2}-\d{2})",
    re.I | re.DOTALL,
)


def _try_airtel_sent(text: str) -> Optional[ParsedTransaction]:
    m = _RE_AIRTEL_SENT.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    fee = _extract_fee(text)
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="expense",
        amount_rwf=amount,
        fee_rwf=fee,
        balance_after_rwf=_extract_balance(text),
        to_who=counterpart,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# Airtel Money — money received
# Inferred format: "You have received X RWF from NAME on YYYY-MM-DD..."
_RE_AIRTEL_RECEIVED = re.compile(
    r"[Yy]ou\s+have\s+received\s+([\d,]+)\s*RWF\s+from\s+([^on\d]+?)\s+on\s+"
    r"(\d{4}-\d{2}-\d{2})",
    re.I | re.DOTALL,
)


def _try_airtel_received(text: str) -> Optional[ParsedTransaction]:
    m = _RE_AIRTEL_RECEIVED.search(text)
    if not m:
        return None
    amount = _to_float(m.group(1))
    counterpart = m.group(2).strip().rstrip(".")
    tx_time = _extract_datetime(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=tx_time,
        transaction_type="income",
        amount_rwf=amount,
        fee_rwf=0.0,
        balance_after_rwf=_extract_balance(text),
        to_who=None,
        from_who=counterpart,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=1.0,
    )


# ─── Parser registry ───────────────────────────────────────────────────────────
# Order is significant: more specific patterns must precede more general ones.
# To extend: implement a new _try_* function and append it here.

_PARSERS: list[Callable[[str], Optional[ParsedTransaction]]] = [
    _try_mtn_cash_withdrawal,       # Unique "via agent" keyword — highest specificity
    _try_mtn_peer_transfer,         # "X RWF transferred to NAME (PHONE)"
    _try_mtn_merchant_explicit,     # "Your payment of X RWF to MERCHANT"
    _try_mtn_merchant_system,       # "A transaction of X RWF by MERCHANT"
    _try_mtn_bank_transfer_out,     # "Your transfer of X RWF to BANK account"
    _try_mtn_received,              # "You have received X RWF from NAME (*****XXX)"
    _try_airtel_sent,               # Airtel: "sent X RWF to NAME on DATE"
    _try_airtel_received,           # Airtel: "received X RWF from NAME on DATE"
]


# ─── Public API ────────────────────────────────────────────────────────────────

def parse_momo_sms(raw_sms: str, sender: Optional[str] = None) -> ParsedTransaction:
    """
    Parse a raw Mobile Money SMS string into a structured ParsedTransaction.

    Tries each registered parser in priority order.  When no pattern matches,
    returns a result with ``parse_confidence=0.0`` and
    ``transaction_type='unknown'`` so callers can route the message to the
    failed-parse bucket without silently discarding it.

    Args:
        raw_sms: Raw SMS text as received on the Android device.
        sender:  Optional sender name/address from the device (used for
                 provider detection).

    Returns:
        A fully populated ParsedTransaction dataclass instance.
    """
    text = raw_sms.strip()
    provider = _detect_provider(sender, text)
    for parser in _PARSERS:
        result = parser(text)
        if result is not None:
            result.provider = provider
            return result

    # Fallback: no pattern matched — return unrecognised marker for caller to handle
    amount = _best_effort_amount(text)
    return ParsedTransaction(
        raw_sms_text=text,
        raw_sms_hash=_compute_hash(text),
        sms_time=_now_iso(),
        transaction_time=_extract_datetime(text),
        transaction_type="unknown",
        amount_rwf=amount,
        fee_rwf=0.0,
        balance_after_rwf=_extract_balance(text),
        to_who=None,
        from_who=None,
        transaction_reference=_extract_transaction_reference(text),
        parse_confidence=0.0,
        provider=provider,
    )


def _best_effort_amount(text: str) -> float:
    """Extract the first RWF amount from an unrecognised SMS as a best-effort fallback."""
    m = re.search(r"([\d,]+)\s*RWF", text, re.I)
    return _to_float(m.group(1)) if m else 0.0

