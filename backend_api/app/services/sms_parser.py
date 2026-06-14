"""
Mobile Money SMS Parser for SmartSpend.

Supports MTN Mobile Money and Airtel Money Rwanda SMS formats.
To add support for a new SMS format, implement a new _try_* function
and register it in the _PARSERS list in priority order.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional


# ─── Transaction type constants ────────────────────────────────────────────────

class TransactionType:
    MERCHANT_PAYMENT       = "MERCHANT_PAYMENT"
    PEER_TRANSFER          = "PEER_TRANSFER"
    CASH_WITHDRAWAL        = "CASH_WITHDRAWAL"
    BANK_TRANSFER          = "BANK_TRANSFER"
    PEER_TRANSFER_RECEIVED = "PEER_TRANSFER_RECEIVED"
    BANK_TRANSFER_RECEIVED = "BANK_TRANSFER_RECEIVED"
    AIRTIME_PURCHASE       = "AIRTIME_PURCHASE"
    UNKNOWN                = "UNKNOWN"


class Direction:
    INCOMING = "INCOMING"
    OUTGOING = "OUTGOING"


# ─── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class ParsedTransaction:
    raw_sms:          str
    transaction_type: str
    direction:        str
    amount_rwf:       float
    fee_rwf:          float
    total_amount_rwf: float   # amount_rwf + fee_rwf for OUTGOING; amount_rwf for INCOMING
    currency:         str
    counterpart_name: str
    timestamp:        str     # ISO-8601 (UTC)
    balance_after_rwf: Optional[float]
    description:      str


# ─── Shared helper functions ───────────────────────────────────────────────────

def _to_float(s: str) -> float:
    return float(s.replace(",", "").strip())


def _extract_fee(text: str) -> float:
    m = re.search(r"[Ff]ee[:\s]+([0-9][0-9,]*)\s*(?:RWF)?", text)
    return _to_float(m.group(1)) if m else 0.0


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


def _desc(verb: str, amount: float, prep: str, counterpart: str) -> str:
    return f"{verb} {int(amount):,} RWF {prep} {counterpart}"


# ─── Parser implementations ────────────────────────────────────────────────────
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.MERCHANT_PAYMENT,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=fee,
        total_amount_rwf=amount + fee,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Paid", amount, "to", counterpart),
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.MERCHANT_PAYMENT,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=fee,
        total_amount_rwf=amount + fee,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Paid", amount, "to", counterpart),
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.PEER_TRANSFER,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=fee,
        total_amount_rwf=amount + fee,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Transferred", amount, "to", counterpart),
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.CASH_WITHDRAWAL,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=fee,
        total_amount_rwf=amount + fee,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Withdrew", amount, "via agent", counterpart),
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
    is_bank_b2c = bool(_RE_B2C.search(text))
    tx_type = (
        TransactionType.BANK_TRANSFER_RECEIVED if is_bank_b2c
        else TransactionType.PEER_TRANSFER_RECEIVED
    )
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=tx_type,
        direction=Direction.INCOMING,
        amount_rwf=amount,
        fee_rwf=0.0,
        total_amount_rwf=amount,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Received", amount, "from", counterpart),
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.BANK_TRANSFER,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=fee,
        total_amount_rwf=amount + fee,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Transferred", amount, "to bank", counterpart),
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.PEER_TRANSFER,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=fee,
        total_amount_rwf=amount + fee,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Sent", amount, "to", counterpart),
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
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.PEER_TRANSFER_RECEIVED,
        direction=Direction.INCOMING,
        amount_rwf=amount,
        fee_rwf=0.0,
        total_amount_rwf=amount,
        currency="RWF",
        counterpart_name=counterpart,
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=_desc("Received", amount, "from", counterpart),
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

def parse_momo_sms(raw_sms: str) -> ParsedTransaction:
    """
    Parse a raw Mobile Money SMS string into a structured ParsedTransaction.

    Tries each registered parser in priority order. Returns an UNKNOWN
    transaction if no pattern matches, preserving the raw text for manual review.

    Args:
        raw_sms: Raw SMS text as received on the Android device.

    Returns:
        A fully populated ParsedTransaction dataclass instance.
    """
    text = raw_sms.strip()
    for parser in _PARSERS:
        result = parser(text)
        if result is not None:
            return result

    # Fallback: no pattern matched
    amount = _best_effort_amount(text)
    return ParsedTransaction(
        raw_sms=text,
        transaction_type=TransactionType.UNKNOWN,
        direction=Direction.OUTGOING,
        amount_rwf=amount,
        fee_rwf=0.0,
        total_amount_rwf=amount,
        currency="RWF",
        counterpart_name="Unknown",
        timestamp=_extract_datetime(text),
        balance_after_rwf=_extract_balance(text),
        description=f"Unrecognised transaction — {int(amount):,} RWF",
    )


def _best_effort_amount(text: str) -> float:
    """Extract the first RWF amount from an unrecognised SMS as a best-effort fallback."""
    m = re.search(r"([\d,]+)\s*RWF", text, re.I)
    return _to_float(m.group(1)) if m else 0.0
