import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import get_current_user_id
from app.core.database import get_db
from app.schemas.schemas import (
    CategorizeRequest,
    CategorizeResponse,
    CategoryListResponse,
    ExpenseForecastRequest,
    ExpenseForecastResponse,
    IncomeForecastRequest,
    IncomeForecastResponse,
    RetrainResponse,
    RetrainingJobStatus,
)
from app.services.model_service import model_service
from app.services.retraining_service import (
    create_job,
    retrain_category_model,
    retrain_expense_forecast,
    retrain_income_forecast,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# The 10 fixed expense categories â€” source of truth for the mobile category picker.
# Must stay in sync with the training dataset categories and model output classes.
_EXPENSE_CATEGORIES: list[str] = [
    "Food & Dining",
    "Transport",
    "Groceries",
    "Communication",
    "Education",
    "Utilities",
    "Health",
    "Entertainment",
    "Savings & Investments",
    "Personal Transfer",
]


# â”€â”€â”€ GET /models/categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get(
    "/categories",
    response_model=CategoryListResponse,
    summary="Return the list of valid expense categories",
)
def list_categories(user_id: str = Depends(get_current_user_id)) -> CategoryListResponse:
    return CategoryListResponse(categories=_EXPENSE_CATEGORIES)


# â”€â”€â”€ POST /models/categorize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post(
    "/categorize",
    response_model=CategorizeResponse,
    summary="Predict the expense category for a purchase item",
)
def categorize(
    payload: CategorizeRequest,
    user_id: str = Depends(get_current_user_id),
) -> CategorizeResponse:
    """
    Run the expense_category model on a set of item-level features.
    Returns the predicted category and confidence score.
    """
    features = payload.model_dump()
    result   = model_service.categorize(user_id, features)
    return CategorizeResponse(
        category=result["category"],
        confidence=result["confidence"],
        probabilities=result["probabilities"],
        model_scope=result["model_scope"],
    )


# â”€â”€â”€ POST /models/expense-forecast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post(
    "/expense-forecast",
    response_model=ExpenseForecastResponse,
    summary="Predict month-end total expense",
)
def forecast_expense(
    payload: ExpenseForecastRequest,
    user_id: str = Depends(get_current_user_id),
) -> ExpenseForecastResponse:
    """Run the monthly_expense_forecast model and return the predicted month-end total."""
    result = model_service.forecast_expense(user_id, payload.model_dump())
    return ExpenseForecastResponse(**result)


# â”€â”€â”€ POST /models/income-forecast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post(
    "/income-forecast",
    response_model=IncomeForecastResponse,
    summary="Predict month-end total income",
)
def forecast_income(
    payload: IncomeForecastRequest,
    user_id: str = Depends(get_current_user_id),
) -> IncomeForecastResponse:
    """Run the monthly_income_forecast model and return the predicted month-end total."""
    result = model_service.forecast_income(user_id, payload.model_dump())
    return IncomeForecastResponse(**result)


# â”€â”€â”€ POST /models/category/retrain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post(
    "/category/retrain",
    response_model=RetrainResponse,
    status_code=202,
    summary="Trigger retraining of the expense_category model",
)
def trigger_category_retrain(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    job_id = create_job(user_id, "expense_category")
    background_tasks.add_task(retrain_category_model, job_id, user_id)
    return {"job_id": job_id, "status": "queued",
            "message": "expense_category model retraining queued."}


# â”€â”€â”€ POST /models/expense-forecast/retrain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post(
    "/expense-forecast/retrain",
    response_model=RetrainResponse,
    status_code=202,
    summary="Trigger retraining of the monthly_expense_forecast model",
)
def trigger_expense_forecast_retrain(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    job_id = create_job(user_id, "monthly_expense_forecast")
    background_tasks.add_task(retrain_expense_forecast, job_id, user_id)
    return {"job_id": job_id, "status": "queued",
            "message": "monthly_expense_forecast model retraining queued."}


# â”€â”€â”€ POST /models/income-forecast/retrain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post(
    "/income-forecast/retrain",
    response_model=RetrainResponse,
    status_code=202,
    summary="Trigger retraining of the monthly_income_forecast model",
)
def trigger_income_forecast_retrain(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    job_id = create_job(user_id, "monthly_income_forecast")
    background_tasks.add_task(retrain_income_forecast, job_id, user_id)
    return {"job_id": job_id, "status": "queued",
            "message": "monthly_income_forecast model retraining queued."}


# â”€â”€â”€ GET /models/jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get(
    "/jobs",
    response_model=list[RetrainingJobStatus],
    summary="List retraining jobs for the current user",
)
def list_retraining_jobs(
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM retraining_jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT 50",
            (user_id,),
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["metrics"] = json.loads(d.pop("metrics_json", None) or "{}")
        result.append(d)
    return result


# â”€â”€â”€ GET /models/jobs/{job_id} â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get(
    "/jobs/{job_id}",
    response_model=RetrainingJobStatus,
    summary="Get the status of a specific retraining job",
)
def get_retraining_job(
    job_id:  int,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM retraining_jobs WHERE id = ? AND user_id = ?",
            (job_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Retraining job not found.")
    d = dict(row)
    d["metrics"] = json.loads(d.pop("metrics_json", None) or "{}")
    return d
