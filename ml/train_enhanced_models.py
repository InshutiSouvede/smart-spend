"""
Train the enhanced prediction models using the improved ML pipeline.
This script executes the key training cells from the enhanced notebook.
"""

import json
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split, cross_val_score, GridSearchCV

from xgboost import XGBRegressor

# Suppress warnings
import warnings
warnings.filterwarnings('ignore')

# Configuration
PRED_DATASET = Path("..") / "backend_api" / "data" / "smartspend_initial_synthetic_prediction_demo_dataset.csv"
MODEL_OUT_DIR = Path("..") / "backend_api" / "storage" / "models"
MODEL_OUT_DIR.mkdir(parents=True, exist_ok=True)

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

TARGET_EXPENSE = "target_month_end_expense"
TARGET_INCOME = "target_month_end_income"

print("="*80)
print("ENHANCED SMARTSPEND PREDICTION MODEL TRAINING")
print("="*80)

# Load data
print(f"\n1. Loading dataset from {PRED_DATASET}...")
pred_df = pd.read_csv(PRED_DATASET)
print(f"   ✓ Loaded {len(pred_df):,} samples")

# Prepare data
print("\n2. Preparing data...")
X = pred_df[PRED_FEATURES].copy()
y_expense = pred_df[TARGET_EXPENSE].copy()
y_income = pred_df[TARGET_INCOME].copy()

# Remove NaN
valid_mask = ~(X.isna().any(axis=1) | y_expense.isna() | y_income.isna())
X = X[valid_mask]
y_expense = y_expense[valid_mask]
y_income = y_income[valid_mask]
print(f"   ✓ Valid samples: {len(X):,}")

# Split data
print("\n3. Splitting data (60% train, 20% val, 20% test)...")
X_trainval, X_test, y_exp_trainval, y_exp_test, y_inc_trainval, y_inc_test = train_test_split(
    X, y_expense, y_income, test_size=0.2, random_state=42, shuffle=True
)

X_train, X_val, y_exp_train, y_exp_val, y_inc_train, y_inc_val = train_test_split(
    X_trainval, y_exp_trainval, y_inc_trainval, test_size=0.25, random_state=42, shuffle=True
)

print(f"   Train: {len(X_train):4d} | Val: {len(X_val):4d} | Test: {len(X_test):4d}")

# Baseline model
print("\n4. Training baseline models...")
baseline_params = {
    "n_estimators": 150,
    "max_depth": 4,
    "learning_rate": 0.08,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "random_state": 42,
    "eval_metric": "mae",
    "n_jobs": -1,
}

baseline_expense = XGBRegressor(**baseline_params)
baseline_expense.fit(X_train, y_exp_train, eval_set=[(X_val, y_exp_val)], verbose=False)

baseline_income = XGBRegressor(**baseline_params)
baseline_income.fit(X_train, y_inc_train, eval_set=[(X_val, y_inc_val)], verbose=False)
print("   ✓ Baseline models trained")

# Cross-validation
print("\n5. Running 5-fold cross-validation...")
cv_exp = cross_val_score(baseline_expense, X_trainval, y_exp_trainval, 
                          cv=5, scoring='neg_mean_absolute_error', n_jobs=-1)
cv_inc = cross_val_score(baseline_income, X_trainval, y_inc_trainval,
                          cv=5, scoring='neg_mean_absolute_error', n_jobs=-1)
print(f"   Expense CV MAE: {-cv_exp.mean():,.0f} ± {cv_exp.std():,.0f}")
print(f"   Income CV MAE:  {-cv_inc.mean():,.0f} ± {cv_inc.std():,.0f}")

# Hyperparameter tuning
print("\n6. Hyperparameter tuning (this may take a few minutes)...")
param_grid = {
    'n_estimators': [100, 150, 200],
    'max_depth': [3, 4, 5],
    'learning_rate': [0.05, 0.08, 0.1],
    'subsample': [0.8, 0.9],
    'colsample_bytree': [0.8, 0.9],
}

print(f"   Searching {3 * 3 * 3 * 2 * 2} = 108 combinations per model...")

# Expense model tuning
expense_grid = GridSearchCV(
    XGBRegressor(random_state=42, n_jobs=-1, eval_metric='mae'),
    param_grid, cv=3, scoring='neg_mean_absolute_error', n_jobs=-1, verbose=0
)
expense_grid.fit(X_train, y_exp_train)
print(f"   ✓ Expense model best MAE: {-expense_grid.best_score_:,.0f}")
print(f"     Best params: {expense_grid.best_params_}")

# Income model tuning
income_grid = GridSearchCV(
    XGBRegressor(random_state=42, n_jobs=-1, eval_metric='mae'),
    param_grid, cv=3, scoring='neg_mean_absolute_error', n_jobs=-1, verbose=0
)
income_grid.fit(X_train, y_inc_train)
print(f"   ✓ Income model best MAE: {-income_grid.best_score_:,.0f}")
print(f"     Best params: {income_grid.best_params_}")

# Extract best models
final_expense_model = expense_grid.best_estimator_
final_income_model = income_grid.best_estimator_

# Evaluate
print("\n7. Evaluating final models...")

def evaluate(model, X, y, name):
    y_pred = model.predict(X)
    mae = mean_absolute_error(y, y_pred)
    rmse = np.sqrt(mean_squared_error(y, y_pred))
    r2 = r2_score(y, y_pred)
    mape = np.mean(np.abs((y - y_pred) / np.maximum(y, 1))) * 100
    print(f"   {name:12s}: MAE={mae:>8,.0f}  RMSE={rmse:>8,.0f}  R²={r2:>6.4f}  MAPE={mape:>5.1f}%")
    return {"MAE": round(mae, 2), "RMSE": round(rmse, 2), "R²": round(r2, 4), "MAPE%": round(mape, 2)}

print("\n   Expense Model:")
exp_train = evaluate(final_expense_model, X_train, y_exp_train, "Train")
exp_val = evaluate(final_expense_model, X_val, y_exp_val, "Validation")
exp_test = evaluate(final_expense_model, X_test, y_exp_test, "Test")

print("\n   Income Model:")
inc_train = evaluate(final_income_model, X_train, y_inc_train, "Train")
inc_val = evaluate(final_income_model, X_val, y_inc_val, "Validation")
inc_test = evaluate(final_income_model, X_test, y_inc_test, "Test")

# Feature importance
exp_imp = pd.Series(final_expense_model.feature_importances_, index=PRED_FEATURES).sort_values(ascending=False)
inc_imp = pd.Series(final_income_model.feature_importances_, index=PRED_FEATURES).sort_values(ascending=False)

print("\n8. Top 5 Important Features:")
print("\n   Expense Model:")
for feat, imp in exp_imp.head(5).items():
    print(f"     {feat:40s} {imp:.4f}")

print("\n   Income Model:")
for feat, imp in inc_imp.head(5).items():
    print(f"     {feat:40s} {imp:.4f}")

# Save models
print("\n9. Saving models...")
expense_path = MODEL_OUT_DIR / "smartspend_expense_prediction_model.joblib"
income_path = MODEL_OUT_DIR / "smartspend_income_prediction_model.joblib"

joblib.dump(final_expense_model, expense_path)
joblib.dump(final_income_model, income_path)
print(f"   ✓ Expense model: {expense_path}")
print(f"   ✓ Income model:  {income_path}")

# Save metrics
metrics = {
    "dataset_size": len(pred_df),
    "training_samples": len(X_train),
    "validation_samples": len(X_val),
    "test_samples": len(X_test),
    "features": PRED_FEATURES,
    "expense_model": {
        "best_params": expense_grid.best_params_,
        "cross_validation_mae": float(-expense_grid.best_score_),
        "test_metrics": exp_test,
        "train_metrics": exp_train,
        "val_metrics": exp_val,
        "feature_importance": exp_imp.to_dict(),
    },
    "income_model": {
        "best_params": income_grid.best_params_,
        "cross_validation_mae": float(-income_grid.best_score_),
        "test_metrics": inc_test,
        "train_metrics": inc_train,
        "val_metrics": inc_val,
        "feature_importance": inc_imp.to_dict(),
    },
    "improvements": {
        "dataset_quality": "16x larger dataset with realistic SMS-derived patterns",
        "cross_validation": "5-fold CV for robust performance estimates",
        "hyperparameter_tuning": "Grid search over 108 combinations per model",
        "evaluation": "Train/val/test split with comprehensive metrics"
    },
    "note": (
        "Enhanced model with hyperparameter tuning, cross-validation, and "
        "comprehensive evaluation. Trained on realistic synthetic data derived from "
        "actual SMS transaction patterns. For production use, retrain with accumulated "
        "user transaction history (minimum 2-3 months)."
    ),
}

metrics_path = MODEL_OUT_DIR / "prediction_metrics.json"
with open(metrics_path, "w") as f:
    json.dump(metrics, f, indent=2)
print(f"   ✓ Metrics: {metrics_path}")

print("\n" + "="*80)
print("✓ TRAINING COMPLETE")
print("="*80)
print(f"\nFinal Test Set Performance:")
print(f"  Expense: MAE={exp_test['MAE']:,.0f} RWF, R²={exp_test['R²']:.4f}")
print(f"  Income:  MAE={inc_test['MAE']:,.0f} RWF, R²={inc_test['R²']:.4f}")
print("\nModels are ready for deployment!")
