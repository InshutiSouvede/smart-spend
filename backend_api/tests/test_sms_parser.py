"""
Unit tests for the SmartSpend Mobile Money SMS parser.

Run with:
    cd backend_api
    python -m pytest tests/test_sms_parser.py -v

No external dependencies required — pure Python stdlib + the sms_parser module.
"""

import sys
import os

# Allow running from the backend_api directory or project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.sms_parser import (
    SENSITIVE_KEYWORDS,
    detect_sensitive_flags,
    parse_momo_sms,
)


# ─── Fixtures: real MTN MoMo messages from sample-sms.json ─────────────────────

MTN_PEER_TRANSFER = (
    "*165*S*800 RWF transferred to Pierre NTIVUGURUZWA (250790024102)"
    " at 2025-11-12 21:20:12 .Fee : 20 RWF. Balance: 3995 RWF. *RW##"
)

MTN_MERCHANT_EXPLICIT = (
    "TxId:24082593281*S*Your payment of 550 RWF to HI-PONCTUAL 005416"
    " was completed at 2025-11-12 22:08:26.  Balance: 3,445 RWF. Fee 0 RWF.*EN#"
)

MTN_RECEIVED_B2C = (
    "You have received 40000 RWF from INSHUTI SOUVEDE JOYEUSE"
    " INSHUTI SOUVEDE JOYEUSE (*********572) at 2025-11-13 08:45:24."
    " Message from sender: Transfer from INSHUTI SOUVEDE JOYEUSE-250790250014"
    " Equity B2C. Balance:43445 RWF. FT Id: 24085829488."
)

MTN_RECEIVED_PEER = (
    "You have received 30000 RWF from Jean D Amour MVUYEKURE (*********028)"
    " at 2025-11-15 19:52:01 . Balance:265895 RWF. FT Id: 24141390325."
)

MTN_MERCHANT_SYSTEM = (
    "*164*S*Y'ello, A transaction of 2000 RWF by MTN RWANDACELL  LIMITED"
    " was completed at 2025-11-15 12:45:45. Balance:9615 RWF. Fee  0 RWF."
    " FT Id: 24131113704. ET  Id: 17632035092841631.*RW#"
)

MTN_PEER_TRANSFER_LARGE = (
    "*165*S*150000 RWF transferred to James IRAKOZE (250796519377)"
    " at 2025-11-15 20:00:48 .Fee : 250 RWF. Balance: 135645 RWF. *RW##"
)

UNRECOGNISED_SMS = "Hello, your package has been dispatched. Track at example.com/123"

SENSITIVE_OTP = (
    "Your MTN Mobile Money OTP is 738291. Do not share this code with anyone."
)

SENSITIVE_PASSCODE = (
    "Your MoMo passcode has been reset successfully."
)

SENSITIVE_PASSWORD = (
    "Use the temporary password 1234 to log in."
)

SENSITIVE_PIN = (
    "Never share your PIN with anyone. MTN will never ask for it."
)


# ─── detect_sensitive_flags ─────────────────────────────────────────────────────

class TestDetectSensitiveFlags:

    def test_otp_message_flagged(self):
        flags = detect_sensitive_flags(SENSITIVE_OTP)
        assert "otp" in flags

    def test_passcode_message_flagged(self):
        flags = detect_sensitive_flags(SENSITIVE_PASSCODE)
        assert "passcode" in flags

    def test_password_message_flagged(self):
        flags = detect_sensitive_flags(SENSITIVE_PASSWORD)
        assert "password" in flags

    def test_pin_message_flagged(self):
        flags = detect_sensitive_flags(SENSITIVE_PIN)
        assert any("pin" in f for f in flags), f"Expected pin flag, got {flags}"

    def test_normal_transaction_not_flagged(self):
        assert detect_sensitive_flags(MTN_PEER_TRANSFER) == []
        assert detect_sensitive_flags(MTN_MERCHANT_EXPLICIT) == []
        assert detect_sensitive_flags(MTN_RECEIVED_PEER) == []

    def test_case_insensitive(self):
        assert detect_sensitive_flags("YOUR OTP IS 123456") != []
        assert detect_sensitive_flags("Enter your PASSCODE") != []

    def test_returns_all_matched_keywords(self):
        combined = "Your OTP password is 123. Do not share this one-time code."
        flags = detect_sensitive_flags(combined)
        # Should find multiple matches
        assert len(flags) >= 2


# ─── MTN Peer Transfer ──────────────────────────────────────────────────────────

class TestMTNPeerTransfer:

    def test_type_is_expense(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.transaction_type == "expense"

    def test_amount_extracted(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.amount_rwf == 800.0

    def test_fee_extracted(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.fee_rwf == 20.0

    def test_balance_extracted(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.balance_after_rwf == 3995.0

    def test_counterpart_extracted(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert "Pierre" in r.to_who or "NTIVUGURUZWA" in r.to_who

    def test_from_who_is_none(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.from_who is None

    def test_timestamp_extracted(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert "2025-11-12" in r.transaction_time

    def test_parse_confidence_is_1(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.parse_confidence == 1.0

    def test_provider_detected_from_sender(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER, sender="M-Money")
        assert r.provider == "MTN"

    def test_currency_defaults_to_rwf(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r.currency == "RWF"

    def test_hash_is_sha256_hex(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER)
        assert len(r.raw_sms_hash) == 64
        assert all(c in "0123456789abcdef" for c in r.raw_sms_hash)


# ─── MTN Merchant Explicit (TxId) ───────────────────────────────────────────────

class TestMTNMerchantExplicit:

    def test_type_is_expense(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert r.transaction_type == "expense"

    def test_amount_extracted(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert r.amount_rwf == 550.0

    def test_fee_is_zero(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert r.fee_rwf == 0.0

    def test_balance_extracted(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert r.balance_after_rwf == 3445.0

    def test_transaction_reference_extracted(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert r.transaction_reference == "24082593281"

    def test_counterpart_is_merchant_name(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert "HI-PONCTUAL" in r.to_who

    def test_timestamp_extracted(self):
        r = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert "2025-11-12" in r.transaction_time


# ─── MTN Merchant System (*164*) ────────────────────────────────────────────────

class TestMTNMerchantSystem:

    def test_type_is_expense(self):
        r = parse_momo_sms(MTN_MERCHANT_SYSTEM)
        assert r.transaction_type == "expense"

    def test_amount_extracted(self):
        r = parse_momo_sms(MTN_MERCHANT_SYSTEM)
        assert r.amount_rwf == 2000.0

    def test_counterpart_contains_mtn(self):
        r = parse_momo_sms(MTN_MERCHANT_SYSTEM)
        assert "MTN" in r.to_who.upper()

    def test_provider_detected_from_text(self):
        r = parse_momo_sms(MTN_MERCHANT_SYSTEM, sender=None)
        assert r.provider == "MTN"


# ─── MTN Received ───────────────────────────────────────────────────────────────

class TestMTNReceived:

    def test_type_is_income(self):
        r = parse_momo_sms(MTN_RECEIVED_PEER)
        assert r.transaction_type == "income"

    def test_amount_extracted(self):
        r = parse_momo_sms(MTN_RECEIVED_PEER)
        assert r.amount_rwf == 30000.0

    def test_from_who_extracted(self):
        r = parse_momo_sms(MTN_RECEIVED_PEER)
        assert "MVUYEKURE" in r.from_who or "Jean" in r.from_who

    def test_to_who_is_none(self):
        r = parse_momo_sms(MTN_RECEIVED_PEER)
        assert r.to_who is None

    def test_balance_extracted(self):
        r = parse_momo_sms(MTN_RECEIVED_PEER)
        assert r.balance_after_rwf == 265895.0

    def test_ft_id_as_transaction_reference(self):
        r = parse_momo_sms(MTN_RECEIVED_PEER)
        assert r.transaction_reference == "24141390325"

    def test_b2c_also_classified_as_income(self):
        r = parse_momo_sms(MTN_RECEIVED_B2C)
        assert r.transaction_type == "income"
        assert r.amount_rwf == 40000.0


# ─── Large transfer ─────────────────────────────────────────────────────────────

class TestLargeTransfer:

    def test_amount_with_thousands(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER_LARGE)
        assert r.amount_rwf == 150000.0

    def test_fee_on_large_transfer(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER_LARGE)
        assert r.fee_rwf == 250.0


# ─── Unrecognised / Fallback ────────────────────────────────────────────────────

class TestUnrecognisedFallback:

    def test_parse_confidence_is_zero(self):
        r = parse_momo_sms(UNRECOGNISED_SMS)
        assert r.parse_confidence == 0.0

    def test_transaction_type_is_unknown(self):
        r = parse_momo_sms(UNRECOGNISED_SMS)
        assert r.transaction_type == "unknown"

    def test_raw_text_preserved(self):
        r = parse_momo_sms(UNRECOGNISED_SMS)
        assert r.raw_sms_text == UNRECOGNISED_SMS

    def test_hash_is_present(self):
        r = parse_momo_sms(UNRECOGNISED_SMS)
        assert len(r.raw_sms_hash) == 64

    def test_empty_string_returns_fallback(self):
        r = parse_momo_sms("")
        assert r.parse_confidence == 0.0


# ─── Deduplication: hash consistency ────────────────────────────────────────────

class TestHashDeduplication:

    def test_same_sms_same_hash(self):
        r1 = parse_momo_sms(MTN_PEER_TRANSFER)
        r2 = parse_momo_sms(MTN_PEER_TRANSFER)
        assert r1.raw_sms_hash == r2.raw_sms_hash

    def test_different_sms_different_hash(self):
        r1 = parse_momo_sms(MTN_PEER_TRANSFER)
        r2 = parse_momo_sms(MTN_MERCHANT_EXPLICIT)
        assert r1.raw_sms_hash != r2.raw_sms_hash

    def test_leading_whitespace_stripped(self):
        r1 = parse_momo_sms(MTN_PEER_TRANSFER)
        r2 = parse_momo_sms("   " + MTN_PEER_TRANSFER + "  ")
        # Hashes should match because parse_momo_sms strips whitespace
        assert r1.raw_sms_hash == r2.raw_sms_hash


# ─── Provider detection ──────────────────────────────────────────────────────────

class TestProviderDetection:

    def test_mtn_from_m_money_sender(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER, sender="M-Money")
        assert r.provider == "MTN"

    def test_mtn_from_mtn_sender(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER, sender="MTN")
        assert r.provider == "MTN"

    def test_mtn_from_yello_in_text(self):
        r = parse_momo_sms(MTN_MERCHANT_SYSTEM, sender=None)
        assert r.provider == "MTN"

    def test_airtel_from_sender(self):
        airtel_msg = (
            "You have received 5000 RWF from Test User (*****123)"
            " at 2025-11-15 10:00:00. Balance:10000 RWF. FT Id: 12345."
        )
        r = parse_momo_sms(airtel_msg, sender="Airtel")
        assert r.provider == "Airtel"

    def test_unknown_provider_when_no_hint(self):
        r = parse_momo_sms(MTN_PEER_TRANSFER, sender=None)
        # *165* in the text should still detect MTN
        assert r.provider == "MTN"

    def test_no_provider_for_unrecognised(self):
        r = parse_momo_sms(UNRECOGNISED_SMS, sender=None)
        assert r.provider is None


# ─── Sensitive keywords list is non-empty ───────────────────────────────────────

def test_sensitive_keywords_list_is_populated():
    assert len(SENSITIVE_KEYWORDS) >= 5
    assert any("passcode" in kw for kw in SENSITIVE_KEYWORDS)
    assert any("password" in kw for kw in SENSITIVE_KEYWORDS)
    assert any("otp" in kw for kw in SENSITIVE_KEYWORDS)
