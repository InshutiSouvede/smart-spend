from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─── Auth schemas ─────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str = Field(
        ...,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        description="User email address.",
    )
    password: str = Field(..., min_length=8, max_length=128, description="Minimum 8 characters.")
    display_name: Optional[str] = Field(default=None, max_length=80)


class RegisterResponse(BaseModel):
    user_id: str
    email: str
    display_name: Optional[str]
    access_token: Optional[str] = None
    auth_mode: str


class LoginRequest(BaseModel):
    email: str = Field(
        ...,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        description="User email address.",
    )
    password: str = Field(..., min_length=8, max_length=128, description="Account password.")


class LoginResponse(BaseModel):
    user_id: str
    email: str
    display_name: Optional[str] = None
    access_token: Optional[str] = None
    token_type: str = "bearer"
    auth_mode: str


class UserProfile(BaseModel):
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    auth_mode: str


class UserProfileUpdate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=80)


# ─── SMS / Transaction schemas ────────────────────────────────────────────────

class SMSMessage(BaseModel):
    raw_sms_text: str = Field(..., description="Raw SMS string.")
    source_message_id: Optional[str] = Field(
        default=None, description="Device-side message ID for deduplication."
    )
    sender: Optional[str] = Field(default=None, description="Sender address/name.")
    sms_time: Optional[str] = Field(
        default=None, description="ISO datetime when SMS was received on device."
    )


class SMSIngestRequest(BaseModel):
    consent_confirmed: bool = Field(
        ..., description="Must be true before processing personal SMS data."
    )
    messages: List[SMSMessage] = Field(..., min_length=1, max_length=500)

    model_config = {
        "json_schema_extra": {
            "example": {
                "consent_confirmed": True,
                "messages": [
                    {
                        "raw_sms_text": "TxId:12345*S*Your payment of 2,000 RWF to Bourbon Coffee Kigali was completed at 2026-06-13 10:54:42. Balance: 16,105 RWF. Fee 0 RWF.*EN#",
                        "sender": "MTN"
                    },
                    {
                        "raw_sms_text": "You have received 50000 RWF from ALICE UWERA (*****502) at 2026-06-12 09:00:00. Balance: 66105 RWF. FT Id: 99988.",
                        "sender": "MTN"
                    },
                ],
            }
        }
    }


class SMSTransactionOut(BaseModel):
    id: int
    transaction_type: str           # 'income' or 'expense'
    amount_rwf: float
    fee_rwf: float = 0.0
    balance_after_rwf: Optional[float] = None
    to_who: Optional[str] = None
    from_who: Optional[str] = None
    transaction_time: Optional[str] = None
    transaction_reference: Optional[str] = None
    parse_confidence: float = 1.0
    provider: Optional[str] = None        # 'MTN', 'Airtel', or None
    currency: str = "RWF"
    created_at: Optional[str] = None
    # Populated for expense transactions — null if no purchase details linked yet
    purchase_details: Optional[List["PurchaseDetailOut"]] = None
    match_status: Optional[str] = None
    # Prompt shown when expense has no linked purchase details
    clarification_prompt: Optional[str] = None


class SMSTransactionListResponse(BaseModel):
    items: List[SMSTransactionOut]
    total: int
    page: int
    page_size: int
    has_next: bool


class SMSSyncFailedItem(BaseModel):
    """An SMS that could not be parsed into a recognised transaction format."""
    index: int                        # position in the original request array
    sender: Optional[str] = None
    sms_time: Optional[str] = None
    raw_sms_hash: str                 # SHA-256 of raw text for client-side reference
    reason: str


class SMSSyncSensitiveWarning(BaseModel):
    """An SMS flagged for containing security-sensitive keywords."""
    index: int                        # position in the original request array
    sender: Optional[str] = None
    sms_time: Optional[str] = None
    sensitive_flags: List[str]        # matched sensitive keyword hints
    message: str = (
        "This message appears to contain security-sensitive information "
        "(e.g. a passcode or OTP) and was not stored. Please review it manually."
    )


class SMSSyncResponse(BaseModel):
    """Full result of a POST /transactions/sms/sync call."""
    imported: List[SMSTransactionOut]
    duplicates_skipped: int
    failed: List[SMSSyncFailedItem]
    sensitive_warnings: List[SMSSyncSensitiveWarning]
    last_import_at: Optional[str] = None   # ISO-8601 UTC of this import batch


# ─── Purchase detail schemas ──────────────────────────────────────────────────

class PurchaseDetailIn(BaseModel):
    item_name: str = Field(..., min_length=1)
    normalized_item_name: Optional[str] = None
    quantity: float = Field(default=1.0, gt=0)
    unit: Optional[str] = None
    unit_cost_rwf: Optional[float] = Field(default=None, ge=0)
    total_cost_rwf: float = Field(..., gt=0)
    purchase_time: Optional[str] = None


class PurchaseDetailOut(BaseModel):
    id: int
    source_type: str               # 'receipt' or 'user_prompt'
    item_name: str
    normalized_item_name: Optional[str] = None
    quantity: float = 1.0
    unit: Optional[str] = None
    unit_cost_rwf: Optional[float] = None
    total_cost_rwf: float
    merchant_name: Optional[str] = None
    purchase_time: Optional[str] = None
    predicted_category: Optional[str] = None
    final_category: Optional[str] = None
    category_confidence: Optional[float] = None
    created_at: Optional[str] = None


# ─── User prompt (missing receipt) ───────────────────────────────────────────

class UserPromptResponse(BaseModel):
    """User's answer to the 'what did you buy?' prompt for an unmatched SMS."""
    items: List[PurchaseDetailIn] = Field(..., min_length=1)
    merchant_name: Optional[str] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "merchant_name": "Bourbon Coffee",
                "items": [
                    {"item_name": "Cappuccino", "quantity": 2, "unit": "cup",
                     "unit_cost_rwf": 1500, "total_cost_rwf": 3000},
                    {"item_name": "Croissant", "quantity": 1, "total_cost_rwf": 1500},
                ]
            }
        }
    }


# ─── Receipt schemas ──────────────────────────────────────────────────────────

class ReceiptMatchOut(BaseModel):
    """Current match state for a receipt."""
    matched_sms_id: Optional[int] = None
    match_confidence: Optional[float] = None
    match_status: str = "unmatched"


class ReceiptUploadOut(BaseModel):
    receipt_id: int
    ocr_status: str
    extraction_status: str
    ocr_mode: Optional[str] = None
    merchant_name: Optional[str] = None
    total_amount_rwf: Optional[float] = None
    receipt_timestamp: Optional[str] = None
    match: Optional[ReceiptMatchOut] = None
    purchase_details: List[PurchaseDetailOut] = []
    uploaded_at: Optional[str] = None


class ReceiptSummary(BaseModel):
    receipt_id: int
    ocr_status: str
    extraction_status: str
    merchant_name: Optional[str] = None
    total_amount_rwf: Optional[float] = None
    receipt_timestamp: Optional[str] = None
    match_status: str = "unmatched"
    match_confidence: Optional[float] = None
    matched_sms_id: Optional[int] = None
    item_count: int = 0
    uploaded_at: Optional[str] = None


class ReceiptListResponse(BaseModel):
    items: List[ReceiptSummary]
    total: int
    page: int
    page_size: int
    has_next: bool


class ReceiptLinkRequest(BaseModel):
    """Body for POST /receipts/{id}/link — manually match a receipt to an SMS transaction."""
    sms_transaction_id: int


class ReceiptManualLinkOut(BaseModel):
    """Result of a manual or confirmed receipt ↔ SMS link operation."""
    receipt_id: int
    sms_transaction_id: int
    match_confidence: Optional[float] = None
    match_status: str


# ─── Categorisation schemas ───────────────────────────────────────────────────

class CategoryListResponse(BaseModel):
    categories: List[str]
    custom_categories: List[str] = []


class CustomCategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class CustomCategoryOut(BaseModel):
    id: int
    name: str
    created_at: Optional[str] = None


class CategorizeRequest(BaseModel):
    item_name: str = Field(..., min_length=1)
    normalized_item_name: Optional[str] = None
    merchant_name: Optional[str] = None
    to_who: Optional[str] = None
    quantity: float = Field(default=1.0, gt=0)
    unit: Optional[str] = None
    unit_cost_rwf: Optional[float] = Field(default=None, ge=0)
    total_cost_rwf: float = Field(..., gt=0)
    purchase_month: Optional[int] = Field(default=None, ge=1, le=12)
    purchase_weekday: Optional[int] = Field(default=None, ge=0, le=6)

    model_config = {
        "json_schema_extra": {
            "example": {
                "item_name": "Milk 1L",
                "merchant_name": "Simba Supermarket",
                "quantity": 2,
                "unit": "L",
                "unit_cost_rwf": 600,
                "total_cost_rwf": 1200,
                "purchase_month": 6,
                "purchase_weekday": 1,
            }
        }
    }


class CategorizeResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    category: str
    confidence: float
    probabilities: Dict[str, float]
    model_scope: str


# ─── Category correction schemas ──────────────────────────────────────────────

class CategoryCorrectionRequest(BaseModel):
    purchase_detail_id: int
    corrected_category: str = Field(..., min_length=1)
    trigger_retraining: bool = Field(default=True)


# ─── Forecast schemas ─────────────────────────────────────────────────────────

class ExpenseForecastRequest(BaseModel):
    """15 features required by the trained XGBoost expense-forecast model."""
    day_of_month: int = Field(..., ge=1, le=31)
    income_received_to_date: float = Field(..., ge=0)
    expense_to_date: float = Field(..., ge=0)
    historical_monthly_income_avg: float = Field(..., ge=0)
    historical_monthly_expense_avg: float = Field(..., ge=0)
    food_dining_to_date: float = Field(default=0.0, ge=0)
    transport_to_date: float = Field(default=0.0, ge=0)
    groceries_to_date: float = Field(default=0.0, ge=0)
    communication_to_date: float = Field(default=0.0, ge=0)
    education_to_date: float = Field(default=0.0, ge=0)
    utilities_to_date: float = Field(default=0.0, ge=0)
    health_to_date: float = Field(default=0.0, ge=0)
    entertainment_to_date: float = Field(default=0.0, ge=0)
    savings_investments_to_date: float = Field(default=0.0, ge=0)
    personal_transfer_to_date: float = Field(default=0.0, ge=0)


class IncomeForecastRequest(BaseModel):
    """15 features required by the trained XGBoost income-forecast model."""
    day_of_month: int = Field(..., ge=1, le=31)
    income_received_to_date: float = Field(..., ge=0)
    expense_to_date: float = Field(..., ge=0)
    historical_monthly_income_avg: float = Field(..., ge=0)
    historical_monthly_expense_avg: float = Field(..., ge=0)
    food_dining_to_date: float = Field(default=0.0, ge=0)
    transport_to_date: float = Field(default=0.0, ge=0)
    groceries_to_date: float = Field(default=0.0, ge=0)
    communication_to_date: float = Field(default=0.0, ge=0)
    education_to_date: float = Field(default=0.0, ge=0)
    utilities_to_date: float = Field(default=0.0, ge=0)
    health_to_date: float = Field(default=0.0, ge=0)
    entertainment_to_date: float = Field(default=0.0, ge=0)
    savings_investments_to_date: float = Field(default=0.0, ge=0)
    personal_transfer_to_date: float = Field(default=0.0, ge=0)


class ExpenseForecastResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    predicted_month_end_expense: float
    model_scope: str


class IncomeForecastResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    predicted_month_end_income: float
    model_scope: str


# ─── Retraining schemas ───────────────────────────────────────────────────────

class RetrainResponse(BaseModel):
    job_id: str
    status: str
    message: str


class RetrainingJobStatus(BaseModel):
    model_config = {"protected_namespaces": ()}

    id: int
    user_id: str
    model_type: str
    status: str
    training_rows_count: Optional[int] = None
    metrics: Dict[str, Any] = {}
    error_message: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class ModelVersionOut(BaseModel):
    model_config = {"protected_namespaces": ()}

    id: int
    user_id: str
    model_type: str
    version: int
    model_path: str
    metrics: Dict[str, Any] = {}
    training_rows_count: Optional[int] = None
    is_active: bool
    retraining_job_id: Optional[int] = None
    created_at: Optional[str] = None


# ─── Analytics schemas ────────────────────────────────────────────────────────

class UnmatchedExpenseOut(BaseModel):
    """An expense transaction that hasn't been linked to purchase details yet."""
    sms_transaction_id: int
    amount_rwf: float
    to_who: Optional[str] = None
    transaction_time: Optional[str] = None
    clarification_prompt: Optional[str] = None


class CategorySummary(BaseModel):
    category: str
    total_rwf: float
    item_count: int
    percentage: float


class MonthlySummary(BaseModel):
    period: str
    total_income: float
    total_expense: float
    net: float
    transaction_count: int


class AnalyticsSummary(BaseModel):
    period_start: str
    period_end: str
    total_income: float
    total_expense: float
    net_balance: float
    overspend: bool
    transaction_count: int
    category_breakdown: List[CategorySummary]


class SpendingStatusResponse(BaseModel):
    period: str
    days_elapsed: int
    days_remaining: int
    total_income: float
    total_expense: float
    net_balance: float
    expense_rate_pct: float
    projected_month_end_expense: float
    projected_net: float
    top_category: Optional[str] = None
    top_category_amount: float = 0.0
    top_category_pct: float = 0.0
    risk_level: str
    status_message: str
    call_to_action: str
    predicted_month_end_expense: Optional[float] = None
    predicted_month_end_income: Optional[float] = None
    unmatched_expense_count: int = 0


# Allow forward-reference resolution
SMSTransactionOut.model_rebuild()
