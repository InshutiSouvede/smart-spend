import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from app.core.config import settings
from app.core.database import get_db
from app.services.model_service import (
    CATEGORY_NUM_COLS,
    CATEGORY_TEXT_COL,
    EXPENSE_FORECAST_FEATURES,
    INCOME_FORECAST_FEATURES,
)

logger = logging.getLogger(__name__)

# Dataset paths anchored to this file's location so they resolve correctly
# regardless of the server's working directory.
# retraining_service.py lives at:  backend_api/app/services/
# data/ lives at:                  backend_api/data/
_APP_ROOT = Path(__file__).parent.parent.parent

# Cold-start seed CSV for the category model.
_BASE_CATEGORY_DATASET = _APP_ROOT / "data" / "smartspend_initial_expense_category_classification_demo_dataset.csv"

# Seed CSV for the forecast models (kept for cold-start when user has no history).
_BASE_FORECAST_DATASET = _APP_ROOT / "data" / "smartspend_initial_synthetic_prediction_demo_dataset.csv"


# ─── Job management ───────────────────────────────────────────────────────────

def create_job(user_id: str, model_type: str) -> str:
    """Insert a new retraining job record and return its auto-increment ID as string."""
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO retraining_jobs(user_id, model_type, status)"
            " VALUES (?, ?, ?)",
            (user_id, model_type, "queued"),
        )
    return str(cursor.lastrowid)


def _register_model_version(
    user_id: str,
    model_type: str,
    model_path: str,
    metrics: dict,
    training_rows: int,
    job_id: str,
) -> int:
    """
    Record a trained model artifact in model_versions.

    Deactivates all previous versions for (user_id, model_type) so that
    only the freshly trained artifact has is_active=1.
    Returns the new version number.
    """
    with get_db() as conn:
        conn.execute(
            "UPDATE model_versions SET is_active = 0"
            " WHERE user_id = ? AND model_type = ?",
            (user_id, model_type),
        )
        last = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM model_versions"
            " WHERE user_id = ? AND model_type = ?",
            (user_id, model_type),
        ).fetchone()
        next_version = int(last["v"]) + 1
        conn.execute(
            """
            INSERT INTO model_versions
                (user_id, model_type, version, model_path, metrics_json,
                 training_rows_count, is_active, retraining_job_id)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                user_id, model_type, next_version, model_path,
                json.dumps(metrics), training_rows, int(job_id),
            ),
        )
    logger.info(
        "Model version v%d registered: user='%s' type='%s' path='%s'",
        next_version, user_id, model_type, model_path,
    )
    return next_version


def _update_job(
    job_id: str,
    status: str,
    message: str,
    metrics: dict | None = None,
    model_path: str | None = None,
    training_rows: int | None = None,
    error: str | None = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        if status in {"completed", "failed"}:
            conn.execute(
                "UPDATE retraining_jobs "
                "SET status=?, metrics_json=?, model_path=?, training_rows_count=?,"
                "    error_message=?, completed_at=? "
                "WHERE id=?",
                (
                    status,
                    json.dumps(metrics or {}),
                    model_path,
                    training_rows,
                    error,
                    now,
                    int(job_id),
                ),
            )
        else:
            conn.execute(
                "UPDATE retraining_jobs SET status=?, metrics_json=? WHERE id=?",
                (status, json.dumps(metrics or {"message": message}), int(job_id)),
            )


def _build_text_combined(df: pd.DataFrame) -> pd.Series:
    """Concatenate text feature columns into one string column for TF-IDF."""
    return (
        df.get("item_name", pd.Series("", index=df.index)).fillna("").astype(str)
        + " "
        + df.get("normalized_item_name", pd.Series("", index=df.index)).fillna("").astype(str)
        + " "
        + df.get("merchant_name", pd.Series("", index=df.index)).fillna("").astype(str)
        + " "
        + df.get("to_who", pd.Series("", index=df.index)).fillna("").astype(str)
    ).str.strip()


def _make_category_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer([
        ("text", TfidfVectorizer(ngram_range=(1, 2), max_features=5000, min_df=1), CATEGORY_TEXT_COL),
        ("num",  StandardScaler(), CATEGORY_NUM_COLS),
    ])
    return Pipeline([
        ("prep", preprocessor),
        ("clf",  LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced", random_state=42)),
    ])


# ─── Category model retraining ────────────────────────────────────────────────

def retrain_category_model(job_id: str, user_id: str) -> None:
    """
    Retrain the personalised item-level expense categorisation model.

    Training data priority (highest weight wins):
      1. Base seed CSV — synthetic cold-start foundation (weight 1.0).
      2. User's enriched purchase records — receipt-derived or user-confirmed
         items with a known final_category that were NOT already captured as
         explicit corrections (weights 1.5–2.5 depending on source confidence).
      3. User's explicit category corrections (weight 3.0) — highest signal.

    Evaluation: 5-fold stratified CV + 80/20 hold-out split.
    Final model is retrained on the FULL combined dataset before saving.

    Artifact saved to: storage/models/users/{user_id}/category_model.joblib
    A model_versions row is inserted after each successful save.
    """
    try:
        _update_job(job_id, "running", "Loading training data…")

        # ── 1. Base seed CSV ─────────────────────────────────────────────────
        if not _BASE_CATEGORY_DATASET.exists():
            raise FileNotFoundError(f"Seed category dataset not found: {_BASE_CATEGORY_DATASET}")

        base_df = pd.read_csv(_BASE_CATEGORY_DATASET)
        required_cols = ["item_name", "category"]
        if not all(c in base_df.columns for c in required_cols):
            raise ValueError(f"Seed CSV missing required columns: {required_cols}")

        for col in CATEGORY_NUM_COLS:
            if col not in base_df.columns:
                base_df[col] = 0.0

        # The seed CSV may store purchase_weekday as a day name ("Monday" …).
        # Convert to integer (0=Monday … 6=Sunday) before numeric coercion.
        _DAY_TO_INT = {
            "monday": 0, "tuesday": 1, "wednesday": 2,
            "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
        }
        if base_df["purchase_weekday"].dtype == object:
            base_df["purchase_weekday"] = (
                base_df["purchase_weekday"]
                .str.lower()
                .map(_DAY_TO_INT)
                .fillna(0)
                .astype(float)
            )

        base_df["training_weight"] = (
            base_df.get("training_weight", pd.Series(1.0, index=base_df.index))
            .fillna(1.0)
        )
        base_df[CATEGORY_TEXT_COL] = _build_text_combined(base_df)

        train_df = base_df[[CATEGORY_TEXT_COL] + CATEGORY_NUM_COLS + ["category", "training_weight"]].copy()

        # ── 2. Enriched user purchase records ────────────────────────────────
        # These are real transactions from this user (receipts or user-prompt
        # answers) that carry a confirmed final_category but were NOT submitted
        # as explicit corrections (those arrive in step 3 with a higher weight).
        # Query is strictly scoped to this user; no other user's data is touched.
        with get_db() as conn:
            enriched_rows = conn.execute(
                """
                SELECT
                    pd.item_name,
                    pd.normalized_item_name,
                    pd.merchant_name,
                    pd.quantity,
                    pd.unit_cost_rwf,
                    pd.total_cost_rwf,
                    pd.purchase_time,
                    pd.source_type,
                    ec.final_category          AS category,
                    ec.category_source,
                    tpm.match_status,
                    st.to_who
                FROM purchase_details pd
                JOIN expense_categories ec
                    ON ec.purchase_detail_id = pd.id
                LEFT JOIN transaction_purchase_matches tpm
                    ON tpm.purchase_detail_id = pd.id
                LEFT JOIN sms_transactions st
                    ON st.id = tpm.sms_transaction_id
                WHERE pd.user_id = ?
                  AND ec.final_category IS NOT NULL
                  AND ec.category_source != 'user_correction'
                GROUP BY pd.id
                """,
                (user_id,),
            ).fetchall()

            # ── 3. Explicit user corrections ──────────────────────────────────
            corr_rows = conn.execute(
                "SELECT item_name, normalized_item_name, merchant_name, to_who,"
                "       quantity, unit_cost_rwf, total_cost_rwf,"
                "       purchase_month, purchase_weekday, corrected_category AS category"
                " FROM category_corrections WHERE user_id = ?",
                (user_id,),
            ).fetchall()

        # ── Build enriched DataFrame ─────────────────────────────────────────
        enriched_df = pd.DataFrame([dict(r) for r in enriched_rows])
        enriched_count = 0
        if not enriched_df.empty:
            enriched_df[CATEGORY_TEXT_COL] = _build_text_combined(enriched_df)
            for col in CATEGORY_NUM_COLS:
                if col not in enriched_df.columns:
                    enriched_df[col] = 0.0

            # Derive purchase_month / purchase_weekday from purchase_time
            if "purchase_time" in enriched_df.columns:
                def _extract_month(pt):
                    try:
                        return datetime.fromisoformat(str(pt)[:10]).month
                    except (ValueError, TypeError):
                        return 0

                def _extract_weekday(pt):
                    try:
                        return datetime.fromisoformat(str(pt)[:10]).weekday()
                    except (ValueError, TypeError):
                        return 0

                enriched_df["purchase_month"]   = enriched_df["purchase_time"].apply(_extract_month)
                enriched_df["purchase_weekday"] = enriched_df["purchase_time"].apply(_extract_weekday)

            # Assign training weight based on source confidence:
            #   receipt + user_confirmed match  → 2.5 (highest real-world signal)
            #   receipt-derived (any match)     → 2.0
            #   user-confirmed user_prompt      → 2.0
            #   model-classified (auto_matched) → 1.5
            def _assign_weight(row):
                is_receipt   = row.get("source_type") == "receipt"
                is_confirmed = row.get("match_status") == "user_confirmed"
                if is_receipt and is_confirmed:
                    return 2.5
                if is_receipt:
                    return 2.0
                if is_confirmed:
                    return 2.0
                return 1.5

            enriched_df["training_weight"] = enriched_df.apply(_assign_weight, axis=1)
            enriched_count = len(enriched_df)
            train_df = pd.concat(
                [train_df,
                 enriched_df[[CATEGORY_TEXT_COL] + CATEGORY_NUM_COLS + ["category", "training_weight"]]],
                ignore_index=True,
            )

        # ── Build corrections DataFrame ──────────────────────────────────────
        corrections_df = pd.DataFrame([dict(r) for r in corr_rows])
        correction_count = len(corrections_df)
        if not corrections_df.empty:
            corrections_df[CATEGORY_TEXT_COL] = _build_text_combined(corrections_df)
            for col in CATEGORY_NUM_COLS:
                if col not in corrections_df.columns:
                    corrections_df[col] = 0.0
            corrections_df["training_weight"] = 3.0
            train_df = pd.concat(
                [train_df,
                 corrections_df[[CATEGORY_TEXT_COL] + CATEGORY_NUM_COLS + ["category", "training_weight"]]],
                ignore_index=True,
            )

        train_df = train_df.dropna(subset=[CATEGORY_TEXT_COL, "category"])
        for col in CATEGORY_NUM_COLS:
            train_df[col] = train_df[col].fillna(0.0).astype(float)

        X       = train_df[[CATEGORY_TEXT_COL] + CATEGORY_NUM_COLS]
        y       = train_df["category"]
        weights = train_df["training_weight"].values

        _update_job(job_id, "running", f"Running 5-fold CV on {len(train_df)} records…")

        pipeline = _make_category_pipeline()

        # Adapt n_splits to the minimum class count; some seed-CSV classes may
        # have only 1 sample, which would make stratified CV impossible.
        min_class_count = int(y.value_counts().min())
        n_splits = max(2, min(5, min_class_count))
        can_stratify = min_class_count >= 2

        cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42) if can_stratify \
            else None  # fallback: skip CV for tiny datasets

        if cv is not None:
            cv_scores = cross_val_score(
                pipeline, X, y, cv=cv, scoring="accuracy",
                fit_params={"clf__sample_weight": weights},
                n_jobs=-1,
            )
            cv_mean = float(cv_scores.mean())
            cv_std  = float(cv_scores.std())
        else:
            cv_mean, cv_std = 0.0, 0.0

        # Hold-out split — only stratify when every class has >= 2 samples
        split_kwargs = {"test_size": 0.2, "random_state": 42}
        if can_stratify:
            split_kwargs["stratify"] = y
        X_train, X_test, y_train, y_test, w_train, _ = train_test_split(
            X, y, weights, **split_kwargs
        )
        pipeline.fit(X_train, y_train, clf__sample_weight=w_train)
        y_pred = pipeline.predict(X_test)

        metrics = {
            "test_accuracy":            float(accuracy_score(y_test, y_pred)),
            "test_macro_f1":            float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
            "cv_mean_accuracy":         cv_mean,
            "cv_std_accuracy":          cv_std,
            "cv_n_splits":              n_splits if can_stratify else 0,
            "total_training_records":   int(len(train_df)),
            "user_correction_records":  correction_count,
            "enriched_purchase_records": enriched_count,
            "scope": "personalised_base+enriched+corrections",
        }

        _update_job(job_id, "running", "Retraining on full dataset before saving…")
        pipeline.fit(X, y, clf__sample_weight=weights)

        # Artifact path: storage/models/users/{user_id}/category_model.joblib
        user_dir = Path(settings.user_model_dir) / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        out_path = user_dir / "category_model.joblib"
        joblib.dump(pipeline, out_path)

        _register_model_version(
            user_id=user_id,
            model_type="expense_category",
            model_path=str(out_path),
            metrics=metrics,
            training_rows=len(train_df),
            job_id=job_id,
        )
        _update_job(
            job_id, "completed",
            f"Category model saved (v{metrics.get('test_accuracy', 0):.3f} acc).",
            metrics=metrics,
            model_path=str(out_path),
            training_rows=len(train_df),
        )
        logger.info("Category model retrained for user '%s': %s", user_id, metrics)

    except Exception as exc:
        logger.error("Category retraining failed for '%s': %s", user_id, exc, exc_info=True)
        _update_job(job_id, "failed", str(exc), error=str(exc))


# ─── Expense forecast retraining ──────────────────────────────────────────────

def retrain_expense_forecast(job_id: str, user_id: str) -> None:
    """
    Retrain the XGBoost monthly expense forecast model.

    Training source: monthly_financial_aggregates (expense rows) for this user.
    Falls back to the synthetic scaffold CSV when the user has fewer than 3 months
    of history.
    """
    try:
        _update_job(job_id, "running", "Loading expense forecast training data…")

        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT year, month, category,
                       total_expense_rwf, total_income_rwf
                FROM monthly_financial_aggregates
                WHERE user_id = ?
                ORDER BY year, month
                """,
                (user_id,),
            ).fetchall()

        user_df = pd.DataFrame([dict(r) for r in rows])

        # Count distinct months that have at least some expense data
        has_expense = (
            user_df[user_df["total_expense_rwf"].fillna(0) > 0][["year", "month"]]
            .drop_duplicates()
        )

        if len(has_expense) < 3:
            if not _BASE_FORECAST_DATASET.exists():
                raise FileNotFoundError(f"Forecast dataset not found: {_BASE_FORECAST_DATASET}")
            seed_df = pd.read_csv(_BASE_FORECAST_DATASET)
            logger.info(
                "Expense forecast: user '%s' has < 3 months — using seed CSV (%d rows).",
                user_id, len(seed_df),
            )
            # Build feature rows from the seed CSV (uses old schema for cold-start)
            feature_rows = _seed_expense_features(seed_df)
        else:
            feature_rows = _user_expense_features(user_df)

        if not feature_rows:
            raise ValueError("No training rows could be built for expense forecast.")

        train_df = pd.DataFrame(feature_rows).dropna()
        X = train_df[EXPENSE_FORECAST_FEATURES]
        y = train_df["target_month_end_expense"]

        model = XGBRegressor(
            n_estimators=150, max_depth=4, learning_rate=0.08,
            subsample=0.8, colsample_bytree=0.8, random_state=42,
            eval_metric="mae",
        )
        model.fit(X, y)

        # Artifact path: storage/models/users/{user_id}/expense_forecast_model.joblib
        user_dir = Path(settings.user_model_dir) / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        out_path = user_dir / "expense_forecast_model.joblib"
        joblib.dump(model, out_path)

        fc_metrics = {"training_records": len(train_df), "scope": "user_monthly_aggregates"}
        _register_model_version(
            user_id=user_id,
            model_type="monthly_expense_forecast",
            model_path=str(out_path),
            metrics=fc_metrics,
            training_rows=len(train_df),
            job_id=job_id,
        )
        _update_job(
            job_id, "completed",
            "Expense forecast model saved.",
            metrics=fc_metrics,
            model_path=str(out_path),
            training_rows=len(train_df),
        )
        logger.info("Expense forecast model retrained for user '%s'.", user_id)

    except Exception as exc:
        logger.error("Expense forecast retraining failed for '%s': %s", user_id, exc, exc_info=True)
        _update_job(job_id, "failed", str(exc), error=str(exc))


# Maps category names stored in the DB to the 15-feature column names.
_CATEGORY_TO_FEATURE = {
    "Food & Dining":         "food_dining_to_date",
    "Transport":             "transport_to_date",
    "Groceries":             "groceries_to_date",
    "Communication":         "communication_to_date",
    "Education":             "education_to_date",
    "Utilities":             "utilities_to_date",
    "Health":                "health_to_date",
    "Entertainment":         "entertainment_to_date",
    "Savings & Investments": "savings_investments_to_date",
    "Personal Transfer":     "personal_transfer_to_date",
}


def _pivot_monthly_to_15_features(df: pd.DataFrame, target_col: str) -> list[dict]:
    """
    Pivot per-category monthly_financial_aggregates rows into the 15-feature format.

    df must have columns: year, month, category (nullable), total_expense_rwf,
    total_income_rwf.  Produces one training row per (year, month), simulating
    a mid-month snapshot (day_of_month=15) where half the month's totals have
    accrued.  target_col is either 'target_month_end_expense' or
    'target_month_end_income'.
    """
    cat_feature_names = list(_CATEGORY_TO_FEATURE.values())
    periods = df[["year", "month"]].drop_duplicates().sort_values(["year", "month"])
    rows = []

    for _, period in periods.iterrows():
        year, month = int(period["year"]), int(period["month"])
        month_data = df[(df["year"] == year) & (df["month"] == month)]

        income_rows  = month_data[month_data["category"].isna()]
        expense_rows = month_data[month_data["category"].notna()]

        total_income  = float(income_rows["total_income_rwf"].fillna(0).sum())
        total_expense = float(expense_rows["total_expense_rwf"].fillna(0).sum())

        # Per-category amounts
        cat_amounts = {feat: 0.0 for feat in cat_feature_names}
        for _, cat_row in expense_rows.iterrows():
            feat_name = _CATEGORY_TO_FEATURE.get(str(cat_row.get("category", "")))
            if feat_name:
                cat_amounts[feat_name] = float(cat_row.get("total_expense_rwf") or 0.0)

        # Rolling historical averages (months strictly before this one)
        prior = df[
            (df["year"] < year) | ((df["year"] == year) & (df["month"] < month))
        ]
        if not prior.empty:
            prior_periods = prior[["year", "month"]].drop_duplicates()
            n_prior = max(len(prior_periods), 1)
            hist_income_avg  = float(prior[prior["category"].isna()]["total_income_rwf"].fillna(0).sum()) / n_prior
            hist_expense_avg = float(prior[prior["category"].notna()]["total_expense_rwf"].fillna(0).sum()) / n_prior
        else:
            hist_income_avg  = total_income
            hist_expense_avg = total_expense

        row = {
            "day_of_month":                   15,
            "income_received_to_date":         total_income * 0.5,
            "expense_to_date":                 total_expense * 0.5,
            "historical_monthly_income_avg":   hist_income_avg,
            "historical_monthly_expense_avg":  hist_expense_avg,
            **cat_amounts,
        }
        if target_col == "target_month_end_expense":
            row["target_month_end_expense"] = total_expense
        else:
            row["target_month_end_income"] = total_income
        rows.append(row)

    return rows


def _user_expense_features(df: pd.DataFrame) -> list[dict]:
    """Build 15-feature training rows for the expense forecast model."""
    return _pivot_monthly_to_15_features(df, "target_month_end_expense")


def _seed_expense_features(df: pd.DataFrame) -> list[dict]:
    """
    Build 15-feature training rows from the seed prediction CSV (cold-start).
    The CSV already contains all required column names — just pass them through.
    """
    rows = []
    for _, r in df.iterrows():
        row = {feat: float(r.get(feat, 0.0)) for feat in EXPENSE_FORECAST_FEATURES}
        row["target_month_end_expense"] = float(r.get("target_month_end_expense", 0.0))
        rows.append(row)
    return rows


# ─── Income forecast retraining ───────────────────────────────────────────────

def retrain_income_forecast(job_id: str, user_id: str) -> None:
    """
    Retrain the XGBoost monthly income forecast model.

    Training source: monthly_financial_aggregates (income rows) for this user.
    Falls back to the synthetic scaffold CSV when the user has fewer than 3 months
    of income history.
    """
    try:
        _update_job(job_id, "running", "Loading income forecast training data…")

        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT year, month, category,
                       total_expense_rwf, total_income_rwf
                FROM monthly_financial_aggregates
                WHERE user_id = ?
                ORDER BY year, month
                """,
                (user_id,),
            ).fetchall()

        user_df = pd.DataFrame([dict(r) for r in rows])

        # Count distinct months that have at least some income data
        has_income = (
            user_df[user_df["total_income_rwf"].fillna(0) > 0][["year", "month"]]
            .drop_duplicates()
        )

        if len(has_income) < 3:
            if not _BASE_FORECAST_DATASET.exists():
                raise FileNotFoundError(f"Forecast dataset not found: {_BASE_FORECAST_DATASET}")
            seed_df = pd.read_csv(_BASE_FORECAST_DATASET)
            logger.info(
                "Income forecast: user '%s' has < 3 months — using seed CSV (%d rows).",
                user_id, len(seed_df),
            )
            feature_rows = _seed_income_features(seed_df)
        else:
            feature_rows = _user_income_features(user_df)

        if not feature_rows:
            raise ValueError("No training rows could be built for income forecast.")

        train_df = pd.DataFrame(feature_rows).dropna()
        X = train_df[INCOME_FORECAST_FEATURES]
        y = train_df["target_month_end_income"]

        model = XGBRegressor(
            n_estimators=150, max_depth=4, learning_rate=0.08,
            subsample=0.8, colsample_bytree=0.8, random_state=42,
            eval_metric="mae",
        )
        model.fit(X, y)

        # Artifact path: storage/models/users/{user_id}/income_forecast_model.joblib
        user_dir = Path(settings.user_model_dir) / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        out_path = user_dir / "income_forecast_model.joblib"
        joblib.dump(model, out_path)

        fc_metrics = {"training_records": len(train_df), "scope": "user_monthly_aggregates"}
        _register_model_version(
            user_id=user_id,
            model_type="monthly_income_forecast",
            model_path=str(out_path),
            metrics=fc_metrics,
            training_rows=len(train_df),
            job_id=job_id,
        )
        _update_job(
            job_id, "completed",
            "Income forecast model saved.",
            metrics=fc_metrics,
            model_path=str(out_path),
            training_rows=len(train_df),
        )
        logger.info("Income forecast model retrained for user '%s'.", user_id)

    except Exception as exc:
        logger.error("Income forecast retraining failed for '%s': %s", user_id, exc, exc_info=True)
        _update_job(job_id, "failed", str(exc), error=str(exc))


def _user_income_features(df: pd.DataFrame) -> list[dict]:
    """Build 15-feature training rows for the income forecast model."""
    return _pivot_monthly_to_15_features(df, "target_month_end_income")


def _seed_income_features(df: pd.DataFrame) -> list[dict]:
    """
    Build 15-feature training rows from the seed prediction CSV (cold-start).
    The CSV already contains all required column names — just pass them through.
    """
    rows = []
    for _, r in df.iterrows():
        row = {feat: float(r.get(feat, 0.0)) for feat in INCOME_FORECAST_FEATURES}
        row["target_month_end_income"] = float(r.get("target_month_end_income", 0.0))
        rows.append(row)
    return rows
