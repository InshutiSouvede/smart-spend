from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─── Auth schemas ─────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str = Field(..., description="User email address.")
    password: str = Field(..., min_length=8, description="Minimum 8 characters.")
    display_name: Optional[str] = Field(default=None, max_length=80)

    model_config = {
        "json_schema_extra": {
            "example": {
                "email": "alice@example.com",
                "password": "securepassword123",
                "display_name": "Alice Uwera",
            }
        }
    }


class RegisterResponse(BaseModel):
    user_id: str
    email: str
    display_name: Optional[str]
    access_token: Optional[str] = Field(
        default=None,
        description="Supabase JWT access token. Present in production mode only.",
    )
    auth_mode: str


class UserProfile(BaseModel):
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    auth_mode: str


class UserProfileUpdate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=80)


# ─── Transaction schemas ───────────────────────────────────────────────────────

class SMSIngestRequest(BaseModel):
    consent_confirmed: bool = Field(
        ...,
        description="Must be true before processing personal SMS data.",
    )
    raw_sms_messages: List[str] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Raw MTN MoMo or Airtel Money SMS strings.",
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "consent_confirmed": True,
                "raw_sms_messages": [
                    "TxId:12345*S*Your payment of 2,000 RWF to Bourbon Coffee Kigali was completed at 2026-06-13 10:54:42. Balance: 16,105 RWF. Fee 0 RWF.*EN#",
                    "You have received 50000 RWF from ALICE UWERA (*****502) at 2026-06-12 09:00:00. Balance: 66105 RWF. FT Id: 99988.",
                ],
            }
        }
    }


class TransactionOut(BaseModel):
    id: int
    transaction_type: str
    direction: str
    amount_rwf: float
    fee_rwf: float = 0.0
    total_amount_rwf: float = 0.0
    balance_after_rwf: Optional[float] = None
    currency: str = "RWF"
    counterpart: Optional[str] = None
    description: str
    category: Optional[str] = None
    confidence: Optional[float] = None
    timestamp: Optional[str] = None
    source: str = "sms"
    created_at: Optional[str] = None


class TransactionListResponse(BaseModel):
    items: List[TransactionOut]
    total: int
    page: int
    page_size: int
    has_next: bool


class TransactionCategoryUpdate(BaseModel):
    category: str = Field(..., min_length=1, description="New category label.")
    trigger_retraining: bool = Field(
        default=True,
        description="Queue a personalised retraining job after saving the update.",
    )


# ─── Categorisation schemas ───────────────────────────────────────────────────
class CategoryListResponse(BaseModel):
    categories: List[str] = Field(
        ...,
        description="The complete list of valid expense category labels.",
    )

class CategorizeRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)

    model_config = {
        "json_schema_extra": {
            "example": {"description": "Paid 3500 to Bourbon Coffee Kigali"}
        }
    }


class CategorizeResponse(BaseModel):
    category: str
    confidence: float
    probabilities: Dict[str, float]
    model_scope: str


# ─── Correction schemas ───────────────────────────────────────────────

class CorrectionRequest(BaseModel):
    transaction_id: Optional[int] = None
    description: str = Field(..., min_length=1)
    previous_category: Optional[str] = None
    corrected_category: str = Field(..., min_length=1)
    trigger_retraining: bool = Field(
        default=True,
        description="Queue a background retraining job after saving this correction.",
    )


# ─── Prediction schemas ───────────────────────────────────────────────

class PredictionRequest(BaseModel):
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


class PredictionResponse(BaseModel):
    predicted_month_end_expense: float
    predicted_month_end_income: float
    overspend_risk_score: float = Field(
        ...,
        ge=0,
        le=100,
        description="Estimated proportion of income consumed by expenses at month-end (0–100).",
    )
    note: str


# ─── Retraining schemas ───────────────────────────────────────────────

class RetrainResponse(BaseModel):
    job_id: str
    status: str
    message: str


class RetrainingJobStatus(BaseModel):
    job_id: str
    user_id: str
    model_type: str
    status: str
    message: Optional[str] = None
    metrics: Dict[str, Any] = {}
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


# ─── Receipt schemas ──────────────────────────────────────────────────

class ReceiptItem(BaseModel):
    product_name: str
    price: float


class ReceiptOut(BaseModel):
    receipt_id: int
    original_filename: Optional[str] = None
    extracted_text: str
    parsed_items: List[ReceiptItem]
    matched_transaction_id: Optional[int] = None
    ocr_mode: str
    created_at: Optional[str] = None


class ReceiptSummary(BaseModel):
    receipt_id: int
    original_filename: Optional[str] = None
    ocr_mode: str
    matched_transaction_id: Optional[int] = None
    created_at: Optional[str] = None


# ─── Analytics schemas ────────────────────────────────────────────────────────

class CategorySummary(BaseModel):
    category: str
    total_rwf: float
    transaction_count: int
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


# ─── Spending status schemas ──────────────────────────────────────────────────

class PredictionSummary(BaseModel):
    predicted_month_end_expense: float
    predicted_month_end_income: float
    overspend_risk_score: float = Field(..., ge=0, le=100)


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
    top_category_amount: float
    top_category_pct: float
    risk_level: str
    status_message: str
    call_to_action: str
    prediction: Optional[PredictionSummary] = None
