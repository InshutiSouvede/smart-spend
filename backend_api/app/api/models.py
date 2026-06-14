import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import get_current_user_id
from app.core.database import get_db
from app.schemas.schemas import (
    CategorizeRequest,
    CategorizeResponse,
    CategoryListResponse,
    PredictionRequest,
    PredictionResponse,
    RetrainResponse,
    RetrainingJobStatus,
)
from app.services.model_service import model_service
from app.services.retraining_service import (
    create_job,
    retrain_category_model,
    retrain_prediction_models,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# The 10 fixed expense categories — source of truth for the mobile category picker.
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


# ─── Category list (for mobile picker) ───────────────────────────────────────────────

@router.get(
    "/category/categories",
    response_model=CategoryListResponse,
    summary="List valid expense category labels",
)
def list_categories(
    user_id: str = Depends(get_current_user_id),
) -> CategoryListResponse:
    """
    Returns the complete list of valid expense category labels.
    Use this to populate the category picker in the correction and
    manual transaction UIs.
    """
    return CategoryListResponse(categories=_EXPENSE_CATEGORIES)


# ─── Categorise a description ───────────────────────────────────────────────────────

@router.post(
    "/category/predict",
    response_model=CategorizeResponse,
    summary="Categorise a transaction description",
)
def categorize(
    payload: CategorizeRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Classify a transaction description into one of the 10 fixed expense categories
    using the TF-IDF + Logistic Regression model.
    """
    return model_service.categorize(user_id, payload.description)


@router.post(
    "/category/retrain",
    response_model=RetrainResponse,
    summary="Trigger category model retraining",
)
def start_category_retraining(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Queue an asynchronous retraining job for the personalised category model."""
    job_id = create_job(user_id, "category")
    background_tasks.add_task(retrain_category_model, job_id, user_id)
    return {
        "job_id":  job_id,
        "status":  "queued",
        "message": "Category retraining started.",
    }


# ─── Prediction ────────────────────────────────────────────────────────────────────

@router.post(
    "/prediction/predict",
    response_model=PredictionResponse,
    summary="Predict month-end financial outcome",
)
def predict_month_end(
    payload: PredictionRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Predict month-end expense and income totals and return an overspend risk
    score (0–100) using the XGBoost prediction model.
    """
    return model_service.predict_month_end(user_id, payload.model_dump())


@router.post(
    "/prediction/retrain",
    response_model=RetrainResponse,
    summary="Trigger prediction model retraining",
)
def start_prediction_retraining(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Queue an asynchronous retraining job for the XGBoost prediction models."""
    job_id = create_job(user_id, "prediction")
    background_tasks.add_task(retrain_prediction_models, job_id, user_id)
    return {
        "job_id":  job_id,
        "status":  "queued",
        "message": "Prediction retraining started.",
    }


# ─── Retraining job status ──────────────────────────────────────────────────────────────

@router.get(
    "/retraining/",
    response_model=list[RetrainingJobStatus],
    summary="List all retraining jobs for the current user",
)
def list_retraining_jobs(
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """
    Returns all retraining jobs for the current user, newest first.
    Use this to recover job IDs after an app restart.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM retraining_jobs WHERE user_id = ?"
            " ORDER BY started_at DESC",
            (user_id,),
        ).fetchall()
    result = []
    for row in rows:
        data = dict(row)
        data["metrics"] = json.loads(data.pop("metrics_json") or "{}")
        result.append(data)
    return result


@router.get(
    "/retraining/{job_id}",
    response_model=RetrainingJobStatus,
    summary="Get a retraining job by ID",
)
def get_retraining_status(
    job_id:  str,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Check the current status of a specific retraining job."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM retraining_jobs WHERE job_id = ? AND user_id = ?",
            (job_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Retraining job not found.")
    data = dict(row)
    data["metrics"] = json.loads(data.pop("metrics_json") or "{}")
    return data
