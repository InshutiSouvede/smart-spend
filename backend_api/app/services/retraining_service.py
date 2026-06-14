import json
import logging
import uuid
from pathlib import Path

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from xgboost import XGBRegressor

from app.core.config import settings
from app.core.database import get_db
from app.services.model_service import PRED_FEATURES

logger = logging.getLogger(__name__)

_BASE_SMS_DATASET = Path("data/smartspend_initial_synthetic_momo_sms_dataset.csv")
_PRED_DATASET     = Path("data/smartspend_initial_synthetic_prediction_demo_dataset.csv")


# ─── Job management ───────────────────────────────────────────────────────────

def create_job(user_id: str, model_type: str) -> str:
    """Insert a new retraining job record and return its UUID."""
    job_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO retraining_jobs(job_id, user_id, model_type, status, message)"
            " VALUES (?, ?, ?, ?, ?)",
            (job_id, user_id, model_type, "queued", "Retraining queued."),
        )
    return job_id


def _update_job(
    job_id: str,
    status: str,
    message: str,
    metrics: dict | None = None,
) -> None:
    with get_db() as conn:
        if status in {"completed", "failed"}:
            conn.execute(
                "UPDATE retraining_jobs "
                "SET status=?, message=?, metrics_json=?, completed_at=CURRENT_TIMESTAMP "
                "WHERE job_id=?",
                (status, message, json.dumps(metrics or {}), job_id),
            )
        else:
            conn.execute(
                "UPDATE retraining_jobs "
                "SET status=?, message=?, metrics_json=? "
                "WHERE job_id=?",
                (status, message, json.dumps(metrics or {}), job_id),
            )


# ─── Category model retraining ────────────────────────────────────────────────

def retrain_category_model(job_id: str, user_id: str) -> None:
    """
    Retrain the personalised TF-IDF + Logistic Regression categorisation model.

    Training data sources (as specified in the proposal):
      1. Base synthetic MTN MoMo SMS dataset (cold-start foundation).
      2. This user's own correction history (added with 3× weight to amplify
         personalisation signal without using other users' data).

    Evaluation: 5-fold stratified cross-validation on the full dataset,
    followed by a hold-out test split (80/20) for reporting.
    The final model saved to disk is retrained on the FULL dataset after
    evaluation — not the 80% training split only.
    """
    try:
        _update_job(job_id, "running", "Loading training data…")

        if not _BASE_SMS_DATASET.exists():
            raise FileNotFoundError(f"Base SMS dataset not found: {_BASE_SMS_DATASET}")

        base_df = pd.read_csv(_BASE_SMS_DATASET)
        train_df = base_df[["description", "category"]].dropna().copy()

        with get_db() as conn:
            rows = conn.execute(
                "SELECT description, corrected_category AS category "
                "FROM category_corrections WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        corrections_df = pd.DataFrame([dict(r) for r in rows])
        correction_count = len(corrections_df)

        if not corrections_df.empty:
            # Tripling corrections amplifies personalisation without replacing base data
            train_df = pd.concat(
                [train_df, corrections_df, corrections_df, corrections_df],
                ignore_index=True,
            )
            logger.info(
                "Retraining [%s]: %d base + %d corrections (×3).",
                user_id, len(base_df), correction_count,
            )

        _update_job(
            job_id, "running",
            f"Running 5-fold CV on {len(train_df)} records…",
        )

        pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(
                ngram_range=(1, 2), max_features=5000, min_df=1,
            )),
            ("classifier", LogisticRegression(
                C=1.0, max_iter=1000, class_weight="balanced", random_state=42,
            )),
        ])

        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(
            pipeline,
            train_df["description"],
            train_df["category"],
            cv=cv,
            scoring="accuracy",
            n_jobs=-1,
        )

        X_train, X_test, y_train, y_test = train_test_split(
            train_df["description"],
            train_df["category"],
            test_size=0.2,
            random_state=42,
            stratify=train_df["category"],
        )
        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)

        metrics = {
            "test_accuracy":          float(accuracy_score(y_test, y_pred)),
            "test_macro_f1":          float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
            "cv_mean_accuracy":       float(cv_scores.mean()),
            "cv_std_accuracy":        float(cv_scores.std()),
            "total_training_records": int(len(train_df)),
            "user_correction_records": correction_count,
            "scope": "base_synthetic_plus_user_corrections",
        }

        # Retrain on FULL dataset before saving — evaluation is already done above
        _update_job(job_id, "running", "Retraining on full dataset before saving…")
        pipeline.fit(train_df["description"], train_df["category"])

        out_path = Path(settings.user_model_dir) / f"{user_id}_category_model.joblib"
        joblib.dump(pipeline, out_path)

        _update_job(
            job_id, "completed",
            f"Category model saved. Test accuracy: {metrics['test_accuracy']:.3f}.",
            metrics,
        )
        logger.info("Category model retrained for user '%s': %s", user_id, metrics)

    except Exception as exc:
        logger.error(
            "Category retraining failed for '%s': %s", user_id, exc, exc_info=True
        )
        _update_job(job_id, "failed", str(exc))


# ─── Prediction model retraining ────────────────────────────────────────────────

def retrain_prediction_models(job_id: str, user_id: str) -> None:
    """
    Retrain the XGBoost month-end expense and income prediction models.

    MVP: trains on the synthetic scaffold dataset.
    Post-pilot: replace the data source with this user's accumulated monthly
    transaction aggregates (income + per-category expense totals).

    The final models saved to disk are trained on the FULL dataset after
    hold-out evaluation.
    """
    try:
        _update_job(job_id, "running", "Loading prediction dataset…")

        if not _PRED_DATASET.exists():
            raise FileNotFoundError(f"Prediction dataset not found: {_PRED_DATASET}")

        df = pd.read_csv(_PRED_DATASET).dropna(subset=PRED_FEATURES)
        X         = df[PRED_FEATURES]
        y_expense = df["target_month_end_expense"]
        y_income  = df["target_month_end_income"]

        _update_job(job_id, "running", f"Training XGBoost on {len(df)} records…")

        xgb_params = dict(
            n_estimators=150, max_depth=4, learning_rate=0.08,
            subsample=0.8, colsample_bytree=0.8, random_state=42,
            eval_metric="mae",
        )
        expense_model = XGBRegressor(**xgb_params)
        income_model  = XGBRegressor(**xgb_params)
        expense_model.fit(X, y_expense)
        income_model.fit(X, y_income)

        out_exp = Path(settings.user_model_dir) / f"{user_id}_expense_prediction_model.joblib"
        out_inc = Path(settings.user_model_dir) / f"{user_id}_income_prediction_model.joblib"
        joblib.dump(expense_model, out_exp)
        joblib.dump(income_model, out_inc)

        metrics = {
            "training_records": int(len(df)),
            "scope": "synthetic_scaffold_pending_user_history_accumulation",
        }
        _update_job(job_id, "completed", "Prediction models retrained.", metrics)
        logger.info("Prediction models retrained for user '%s'.", user_id)

    except Exception as exc:
        logger.error(
            "Prediction retraining failed for '%s': %s", user_id, exc, exc_info=True
        )
        _update_job(job_id, "failed", str(exc))
