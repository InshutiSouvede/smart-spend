import logging
from pathlib import Path
from typing import Optional, Tuple

import joblib
import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.exceptions import ModelNotAvailableError

logger = logging.getLogger(__name__)

PRED_FEATURES = [
    "day_of_month",
    "income_received_to_date",
    "expense_to_date",
    "historical_monthly_income_avg",
    "historical_monthly_expense_avg",
    "food_dining_to_date",
    "transport_to_date",
    "groceries_to_date",
    "communication_to_date",
    "education_to_date",
    "utilities_to_date",
    "health_to_date",
    "entertainment_to_date",
    "savings_investments_to_date",
    "personal_transfer_to_date",
]


class ModelService:
    """
    Manages lazy loading and inference for the categorisation and prediction models.

    Models are loaded on first use to allow the API to start even when model
    files are not yet present. A clear error is raised at inference time if a
    required model is missing.
    """

    def __init__(self) -> None:
        self._base_category_model = None
        self._base_expense_model = None
        self._base_income_model = None
        self._category_loaded = False
        self._prediction_loaded = False

    # ─── Private loaders ──────────────────────────────────────────────────────

    def _load(self, path: Path):
        if not path.exists():
            logger.warning("Model file not found: %s", path)
            return None
        try:
            model = joblib.load(path)
            logger.info("Loaded model: %s", path.name)
            return model
        except Exception as exc:
            logger.error("Failed to load model '%s': %s", path, exc)
            return None

    @property
    def _base_cat(self):
        if not self._category_loaded:
            self._base_category_model = self._load(
                Path(settings.model_dir) / "smartspend_category_model.joblib"
            )
            self._category_loaded = True
        return self._base_category_model

    def _ensure_prediction_models(self) -> None:
        if not self._prediction_loaded:
            model_dir = Path(settings.model_dir)
            self._base_expense_model = self._load(
                model_dir / "smartspend_expense_prediction_model.joblib"
            )
            self._base_income_model = self._load(
                model_dir / "smartspend_income_prediction_model.joblib"
            )
            self._prediction_loaded = True

    def _user_cat_path(self, user_id: str) -> Path:
        return Path(settings.user_model_dir) / f"{user_id}_category_model.joblib"

    def _user_exp_path(self, user_id: str) -> Path:
        return Path(settings.user_model_dir) / f"{user_id}_expense_prediction_model.joblib"

    def _user_inc_path(self, user_id: str) -> Path:
        return Path(settings.user_model_dir) / f"{user_id}_income_prediction_model.joblib"

    # ─── Categorisation ───────────────────────────────────────────────────────────

    def _resolve_category_model(self, user_id: str) -> Tuple[object, str]:
        """Return the most personalised available category model for this user."""
        user_path = self._user_cat_path(user_id)
        if user_path.exists():
            model = self._load(user_path)
            if model is not None:
                return model, "user_personalised"
        if self._base_cat is not None:
            return self._base_cat, "base_synthetic"
        raise ModelNotAvailableError("category_model")

    def categorize(self, user_id: str, description: str) -> dict:
        """
        Classify a transaction description into one of the 10 fixed expense categories.

        Returns the predicted category, confidence score, full probability
        distribution, and the model scope (base vs. user-personalised).
        """
        model, scope = self._resolve_category_model(user_id)
        pred = model.predict([description])[0]
        probs = model.predict_proba([description])[0]
        classes = list(model.classes_)
        return {
            "category":     pred,
            "confidence":   float(np.max(probs)),
            "probabilities": {c: float(p) for c, p in zip(classes, probs)},
            "model_scope":  scope,
        }

    # ─── Prediction ─────────────────────────────────────────────────────────────────

    def predict_month_end(self, user_id: str, features: dict) -> dict:
        """
        Predict month-end expense and income totals and compute the overspend risk score.

        Uses user-specific prediction models when available (after a prediction
        retraining job has completed for this user), falling back to the base
        synthetic models otherwise.

        Overspend risk score = (predicted_expense / predicted_income) × 100,
        clamped to [0, 100].
        """
        self._ensure_prediction_models()

        expense_model = None
        income_model = None

        user_exp = self._user_exp_path(user_id)
        user_inc = self._user_inc_path(user_id)
        if user_exp.exists() and user_inc.exists():
            expense_model = self._load(user_exp)
            income_model = self._load(user_inc)

        if expense_model is None:
            expense_model = self._base_expense_model
        if income_model is None:
            income_model = self._base_income_model

        if expense_model is None or income_model is None:
            raise ModelNotAvailableError("prediction_models")

        row = pd.DataFrame([{k: features.get(k, 0.0) for k in PRED_FEATURES}])
        predicted_expense = float(expense_model.predict(row)[0])
        predicted_income  = float(income_model.predict(row)[0])

        # Risk: proportion of income consumed by expenses (0 = safe, 100 = fully spent)
        safe_income = max(predicted_income, 1.0)
        risk_score  = round(max(0.0, min(100.0, (predicted_expense / safe_income) * 100.0)), 2)

        return {
            "predicted_month_end_expense": round(max(0.0, predicted_expense), 2),
            "predicted_month_end_income":  round(max(0.0, predicted_income), 2),
            "overspend_risk_score":        risk_score,
            "note": (
                "Prediction is trained on a synthetic scaffold dataset until "
                "sufficient user transaction history accumulates. Accuracy improves "
                "after 2–3 months of active usage and retraining."
            ),
        }

    def reload_base_models(self) -> None:
        """Force a reload of base models from disk (e.g., after global retraining)."""
        self._category_loaded = False
        self._prediction_loaded = False


model_service = ModelService()
