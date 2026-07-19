import logging
from pathlib import Path
from typing import Optional, Tuple

import joblib
import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.exceptions import ModelNotAvailableError

logger = logging.getLogger(__name__)

# --- Feature definitions -----------------------------------------------

# Column name used by the TF-IDF step in the trained category pipeline
CATEGORY_TEXT_COL = "model_text"

# Numeric columns fed to StandardScaler
CATEGORY_NUM_COLS = [
    "quantity",
    "unit_cost_rwf",
    "total_cost_rwf",
    "purchase_month",
    "purchase_weekday",
]

# All columns the category DataFrame must have
CATEGORY_DF_COLS = [CATEGORY_TEXT_COL] + CATEGORY_NUM_COLS + [
    "price_range_very_cheap", "price_range_cheap", "price_range_medium",
    "price_range_expensive", "price_range_very_expensive",
    "is_weekend", "is_month_start", "is_month_end",
    "text_length", "word_count",
]

# 15-feature set shared by both forecast models (matches trained XGBoost models)
PREDICTION_FEATURES = [
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

EXPENSE_FORECAST_FEATURES = PREDICTION_FEATURES
INCOME_FORECAST_FEATURES  = PREDICTION_FEATURES


def _build_category_df(features: dict) -> pd.DataFrame:
    """Convert a purchase-detail feature dict into a DataFrame for the category model."""
    text = " ".join(filter(None, [
        str(features.get("item_name") or ""),
        str(features.get("normalized_item_name") or ""),
        str(features.get("merchant_name") or ""),
        str(features.get("to_who") or ""),
    ]))
    total_cost = float(features.get("total_cost_rwf") or 0.0)
    weekday = int(features.get("purchase_weekday") or 0)
    month = int(features.get("purchase_month") or 0)

    # Price range one-hot encoding (bins: 0-2000, 2000-10000, 10000-50000, 50000-200000, 200000+)
    price_range_very_cheap = 1.0 if total_cost <= 2000 else 0.0
    price_range_cheap = 1.0 if 2000 < total_cost <= 10000 else 0.0
    price_range_medium = 1.0 if 10000 < total_cost <= 50000 else 0.0
    price_range_expensive = 1.0 if 50000 < total_cost <= 200000 else 0.0
    price_range_very_expensive = 1.0 if total_cost > 200000 else 0.0

    return pd.DataFrame([{
        CATEGORY_TEXT_COL:              text,
        "quantity":                     float(features.get("quantity") or 1.0),
        "unit_cost_rwf":               float(features.get("unit_cost_rwf") or 0.0),
        "total_cost_rwf":              total_cost,
        "purchase_month":              month,
        "purchase_weekday":            weekday,
        "price_range_very_cheap":      price_range_very_cheap,
        "price_range_cheap":           price_range_cheap,
        "price_range_medium":          price_range_medium,
        "price_range_expensive":       price_range_expensive,
        "price_range_very_expensive":  price_range_very_expensive,
        "is_weekend":                  1.0 if weekday in (5, 6) else 0.0,
        "is_month_start":             1.0 if month in (1, 2, 3) else 0.0,
        "is_month_end":               1.0 if month in (10, 11, 12) else 0.0,
        "text_length":                float(len(text)),
        "word_count":                 float(len(text.split())),
    }])


class ModelService:
    """
    Manages lazy loading and inference for three model types:

    1. expense_category    - TF-IDF + numeric -> LogisticRegression (per-user personalised)
    2. monthly_expense_forecast - XGBoost regression on monthly aggregates
    3. monthly_income_forecast  - XGBoost regression on monthly aggregates

    Models are loaded on first use. A clear ModelNotAvailableError is raised
    at inference time if the required model file is absent.
    """

    def __init__(self) -> None:
        self._base_category_model    = None
        self._base_expense_model     = None
        self._base_income_model      = None
        self._category_loaded        = False
        self._expense_fc_loaded      = False
        self._income_fc_loaded       = False

    # --- Loaders -----------------------------------------------------------

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

    def _ensure_forecast_models(self) -> None:
        if not self._expense_fc_loaded:
            d = Path(settings.model_dir)
            self._base_expense_model = self._load(d / "smartspend_expense_prediction_model.joblib")
            self._expense_fc_loaded = True
        if not self._income_fc_loaded:
            d = Path(settings.model_dir)
            self._base_income_model = self._load(d / "smartspend_income_prediction_model.joblib")
            self._income_fc_loaded = True

    def _user_model_path(self, user_id: str, model_type: str) -> Path:
        # Artifact layout: storage/models/users/{user_id}/{model_type}.joblib
        return Path(settings.user_model_dir) / user_id / f"{model_type}.joblib"

    def _resolve_model(self, user_id: str, model_type: str, base_model):
        user_path = self._user_model_path(user_id, model_type)
        if user_path.exists():
            m = self._load(user_path)
            if m is not None:
                return m, "user_personalised"
        if base_model is not None:
            return base_model, "base_synthetic"
        raise ModelNotAvailableError(model_type)

    # --- Categorisation (item-level) ---------------------------------------

    def categorize(self, user_id: str, purchase_features: dict) -> dict:
        """
        Classify a purchase_details row into one of the expense categories.

        purchase_features must contain at minimum: item_name, total_cost_rwf.
        Optional: normalized_item_name, merchant_name, to_who, quantity,
                  unit_cost_rwf, purchase_month, purchase_weekday.
        """
        model, scope = self._resolve_model(user_id, "category_model", self._base_cat)
        df = _build_category_df(purchase_features)
        pred  = model.predict(df)[0]
        probs = model.predict_proba(df)[0]
        classes = list(model.classes_)
        return {
            "category":      pred,
            "confidence":    float(np.max(probs)),
            "probabilities": {c: float(p) for c, p in zip(classes, probs)},
            "model_scope":   scope,
        }

    # --- Expense forecast --------------------------------------------------

    def forecast_expense(self, user_id: str, features: dict) -> dict:
        """
        Predict month-end total expense given current-month aggregates.

        features must include the EXPENSE_FORECAST_FEATURES keys.
        """
        self._ensure_forecast_models()
        model, scope = self._resolve_model(
            user_id, "expense_forecast_model", self._base_expense_model
        )
        row = pd.DataFrame([{k: float(features.get(k, 0.0)) for k in EXPENSE_FORECAST_FEATURES}])
        predicted = float(model.predict(row)[0])
        return {
            "predicted_month_end_expense": round(predicted, 2),
            "model_scope": scope,
        }

    # --- Income forecast ---------------------------------------------------

    def forecast_income(self, user_id: str, features: dict) -> dict:
        """
        Predict month-end total income given current-month aggregates.

        features must include the INCOME_FORECAST_FEATURES keys.
        """
        self._ensure_forecast_models()
        model, scope = self._resolve_model(
            user_id, "income_forecast_model", self._base_income_model
        )
        row = pd.DataFrame([{k: float(features.get(k, 0.0)) for k in INCOME_FORECAST_FEATURES}])
        predicted = float(model.predict(row)[0])
        return {
            "predicted_month_end_income": round(predicted, 2),
            "model_scope": scope,
        }


model_service = ModelService()


# ─── Shared helpers ────────────────────────────────────────────────────────────

def run_category_prediction(
    user_id: str,
    purchase_detail_id: int,
    features: dict,
    conn,
) -> None:
    """
    Run the category model and upsert the result into expense_categories.

    Extracted here to avoid duplicating the same logic across transactions.py
    and receipts.py.  Both routers must call this inside an open DB connection.
    """
    try:
        result = model_service.categorize(user_id, features)
        conn.execute(
            """
            INSERT INTO expense_categories
                (user_id, purchase_detail_id, predicted_category, confidence,
                 final_category, category_source)
            VALUES (?, ?, ?, ?, ?, 'model')
            ON CONFLICT(purchase_detail_id) DO UPDATE SET
                predicted_category = excluded.predicted_category,
                confidence         = excluded.confidence,
                final_category     = excluded.final_category,
                category_source    = 'model'
            """,
            (user_id, purchase_detail_id,
             result["category"], result["confidence"], result["category"]),
        )
    except Exception as exc:
        logger.warning("Category prediction failed for pd_id=%d: %s", purchase_detail_id, exc)

