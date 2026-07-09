import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import get_current_user_id
from app.core.database import get_db
from app.schemas.schemas import (
    CategorizeRequest,
    CategorizeResponse,
    CategoryListResponse,
    CustomCategoryCreate,
    CustomCategoryOut,
    ExpenseForecastRequest,
    ExpenseForecastResponse,
    IncomeForecastRequest,
    IncomeForecastResponse,
    ModelVersionOut,
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

# The 10 fixed expense categories - source of truth for the mobile category picker.
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


# --- GET /models/categories --------------------------------------------

@router.get(
    "/categories",
    response_model=CategoryListResponse,
    summary="Return the list of valid expense categories",
)
def list_categories(user_id: str = Depends(get_current_user_id)) -> CategoryListResponse:
    """Return predefined categories plus user's custom categories."""
    with get_db() as conn:
        custom_rows = conn.execute(
            "SELECT name FROM custom_categories WHERE user_id = ? ORDER BY name",
            (user_id,),
        ).fetchall()
    custom = [r["name"] for r in custom_rows]
    return CategoryListResponse(categories=_EXPENSE_CATEGORIES, custom_categories=custom)


# --- POST /models/categorize -------------------------------------------

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


# --- POST /models/expense-forecast -------------------------------------

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


# --- POST /models/income-forecast --------------------------------------

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


# --- POST /models/category/retrain -------------------------------------

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


# --- POST /models/expense-forecast/retrain -----------------------------

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


# --- POST /models/income-forecast/retrain ------------------------------

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


# --- GET /models/jobs --------------------------------------------------

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


# --- GET /models/jobs/{job_id} -----------------------------------------

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


# ─── GET /models/versions ─────────────────────────────────────────────────────

from typing import Optional  # noqa: E402 — kept local to avoid circular issues

@router.get(
    "/versions",
    response_model=list[ModelVersionOut],
    summary="List trained model versions for the current user",
)
def list_model_versions(
    model_type: Optional[str] = None,
    user_id:    str           = Depends(get_current_user_id),
) -> list[dict]:
    """
    Returns all model artifact records for the authenticated user, newest first.
    Filter by model_type to see only category, expense-forecast, or income-forecast history.
    ``is_active=true`` marks the version currently loaded for inference.
    """
    valid_types = {"expense_category", "monthly_expense_forecast", "monthly_income_forecast"}
    if model_type and model_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"model_type must be one of: {sorted(valid_types)}",
        )

    conditions = ["user_id = ?"]
    params: list = [user_id]
    if model_type:
        conditions.append("model_type = ?")
        params.append(model_type)

    where = " AND ".join(conditions)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM model_versions WHERE {where}"
            f" ORDER BY created_at DESC LIMIT 100",
            params,
        ).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        d["metrics"]   = json.loads(d.pop("metrics_json", None) or "{}")
        d["is_active"] = bool(d["is_active"])
        result.append(d)
    return result


# ─── POST /models/categories/custom ───────────────────────────────────────────

@router.post(
    "/categories/custom",
    response_model=CustomCategoryOut,
    status_code=201,
    summary="Create a new user-specific custom category",
)
def create_custom_category(
    payload: CustomCategoryCreate,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Create a custom expense category visible only to the current user.
    Category names must be unique per user and cannot match predefined categories.
    """
    name = payload.name.strip()
    
    # Prevent creating custom categories with predefined names
    if name in _EXPENSE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"'{name}' is a predefined category and cannot be added as custom.",
        )
    
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO custom_categories (user_id, name) VALUES (?, ?)",
                (user_id, name),
            )
            row = conn.execute(
                "SELECT * FROM custom_categories WHERE user_id = ? AND name = ?",
                (user_id, name),
            ).fetchone()
        except Exception as e:
            if "UNIQUE constraint failed" in str(e):
                raise HTTPException(
                    status_code=400,
                    detail=f"Category '{name}' already exists for this user.",
                )
            raise
    
    return dict(row)


# ─── GET /models/categories/custom ────────────────────────────────────────────

@router.get(
    "/categories/custom",
    response_model=list[CustomCategoryOut],
    summary="List all custom categories for the current user",
)
def list_custom_categories(
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """Return all user-specific custom expense categories, ordered alphabetically."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM custom_categories WHERE user_id = ? ORDER BY name",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ─── DELETE /models/categories/custom/{category_id} ───────────────────────────

@router.delete(
    "/categories/custom/{category_id}",
    status_code=204,
    summary="Delete a custom category",
)
def delete_custom_category(
    category_id: int,
    user_id: str = Depends(get_current_user_id),
) -> None:
    """
    Delete a user-specific custom category. Expenses using this category
    will revert to their predicted category or 'Uncategorised'.
    """
    with get_db() as conn:
        # Verify ownership
        row = conn.execute(
            "SELECT id FROM custom_categories WHERE id = ? AND user_id = ?",
            (category_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Custom category not found.")
        
        # Delete the category
        conn.execute("DELETE FROM custom_categories WHERE id = ?", (category_id,))
        
        # Update expense_categories using this custom category to revert to predicted
        conn.execute(
            """
            UPDATE expense_categories
            SET final_category = predicted_category,
                category_source = 'model'
            WHERE user_id = ? AND final_category = (
                SELECT name FROM custom_categories WHERE id = ? LIMIT 1
            )
            """,
            (user_id, category_id),
        )

