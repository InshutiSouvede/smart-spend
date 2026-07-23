# SmartSpend — Machine Learning Package

This directory contains the training datasets, Jupyter notebooks, and trained model artefacts for the two ML components of the SmartSpend system:

1. **Categorisation model** — TF-IDF vectorisation + Logistic Regression, classifying MTN MoMo expense descriptions into 10 fixed Rwanda-context categories.
2. **Prediction models** — XGBoost regressors predicting month-end expense and income totals, from which an overspend risk score (0–100) is derived.

---

## Directory Structure

```
ml/
├── 01_categorisation_model.ipynb                       Train and evaluate the TF-IDF + LR categorisation model
├── 02_prediction_model.ipynb                           Train and evaluate the XGBoost prediction models
├── SmartSpend_Model_Training_Notebook.ipynb             Combined walkthrough notebook
├── train_enhanced_models.py                            Automated (non-interactive) training script
├── smartspend_initial_models/                          Pre-trained model artefacts (cold-start fallback)
├── smartspend_initial_synthetic_momo_sms_dataset.csv
├── smartspend_initial_synthetic_prediction_demo_dataset.csv
└── requirements.txt
```

Trained model files are saved directly to `../backend_api/storage/models/` so the backend can load them without any manual copy step.

The `smartspend_initial_models/` directory contains a set of pre-trained artefacts (`smartspend_category_model.joblib`, `smartspend_expense_prediction_model.joblib`, `smartspend_income_prediction_model.joblib`) that can be copied to `backend_api/storage/models/` as a cold-start fallback without re-running the notebooks.

---

## Datasets

### 1. `smartspend_initial_synthetic_momo_sms_dataset.csv`

A programmatically generated synthetic dataset of ~2,900 transaction description records derived from real MTN MoMo SMS message templates. Used to initialise the categorisation model before any real user data is available (cold-start).

| Column | Description |
|---|---|
| `description` | Human-readable transaction summary (e.g. "Paid 3500 to Bourbon Coffee Kigali") |
| `category` | One of 10 fixed expense categories |
| `transaction_type` | SENT or RECEIVED |
| `amount_rwf` | Transaction amount in Rwandan Francs |
| `raw_sms` | Synthetic SMS text |

**Key properties:**
- Contains no real user data.
- Covers all 10 expense categories with Rwanda-context merchant names, including Kinyarwanda and English names.
- MTN MoMo format only (initial phase); Airtel Money formats can be added in a future iteration.

### 2. `smartspend_initial_synthetic_prediction_demo_dataset.csv`

A synthetic scaffold dataset for developing and testing the XGBoost month-end prediction pipeline. Each row represents one user-day observation with running category totals and target month-end values.

| Column | Description |
|---|---|
| `day_of_month` | Day of the month (1–31) |
| `income_received_to_date` | Cumulative income received so far this month |
| `expense_to_date` | Cumulative expense so far this month |
| `historical_monthly_income_avg` | User's average monthly income over prior months |
| `historical_monthly_expense_avg` | User's average monthly expense over prior months |
| `food_dining_to_date` — `personal_transfer_to_date` | Per-category running totals (10 features) |
| `target_month_end_expense` | Ground-truth month-end total expense |
| `target_month_end_income` | Ground-truth month-end total income |

**Important:** This dataset is a synthetic scaffold. In the deployed system, the prediction model is retrained using each individual user's accumulated monthly transaction history, not this shared dataset.

---

## Models

### Categorisation Model (`01_categorisation_model.ipynb`)

- **Algorithm:** TF-IDF (unigrams + bigrams, max 5,000 features, min_df=1) + Logistic Regression (C=1.0, balanced class weights, max_iter=1000)
- **Training:** 5-fold stratified cross-validation; full dataset retrain after evaluation before saving
- **Output:** Category label + confidence score + full probability distribution
- **Saved to:** `../backend_api/storage/models/smartspend_category_model.joblib`
- **Retraining:** User corrections are merged with the base dataset (3× weight) and the model is retrained via `POST /models/category/retrain`

### Prediction Models (`02_prediction_model.ipynb`)

- **Algorithm:** XGBoost Regressor (n_estimators=150, max_depth=4, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8)
- **Two models:** One for month-end expense, one for month-end income
- **Features:** 15 features — day_of_month, income_received_to_date, expense_to_date, historical averages, and 10 per-category running totals
- **Output:** Predicted RWF totals + overspend risk score = (expense / income) × 100, clamped to [0, 100]
- **Saved to:** `../backend_api/storage/models/smartspend_expense_prediction_model.joblib` and `smartspend_income_prediction_model.joblib`
- **Retraining:** Triggered via `POST /models/prediction/retrain`

---

## Analysis Workflow

### Prerequisites

```bash
cd ml

# Windows
py -3.12 -m venv .venv && .venv\Scripts\Activate.ps1
# macOS / Linux
python3.12 -m venv .venv && source .venv/bin/activate

pip install -r requirements.txt
jupyter lab
```

### Step 1 — Train the categorisation model

Open and run all cells in **`01_categorisation_model.ipynb`**.

This notebook:
1. Loads `smartspend_initial_synthetic_momo_sms_dataset.csv`
2. Filters to OUTGOING transactions and concatenates the text columns (description, counterpart, etc.) into a single `model_text` column for TF-IDF
3. Runs 5-fold stratified cross-validation and reports accuracy, precision, recall, F1
4. Evaluates on a hold-out test set and prints a confusion matrix
5. Retrains on the full dataset and saves the pipeline to `../backend_api/storage/models/smartspend_category_model.joblib`

> **Column-name note:** The saved scikit-learn pipeline expects a DataFrame with a column named `model_text` (the TF-IDF input column). The backend's serving code (`model_service.py`) and retraining code (`retraining_service.py`) both use `CATEGORY_TEXT_COL = "model_text"` to match this.

> **Backend retraining dataset:** When a user triggers retraining via the API, the backend uses `backend_api/data/smartspend_initial_expense_category_classification_demo_dataset.csv` as the cold-start seed, not the SMS dataset. This file contains purchase-detail records (`item_name`, `merchant_name`, etc.) that match the schema produced by the OCR receipt parser.

### Step 2 — Train the prediction models

Open and run all cells in **`02_prediction_model.ipynb`**.

This notebook:
1. Loads `smartspend_initial_synthetic_prediction_demo_dataset.csv`
2. Builds the 15-feature matrix: `day_of_month`, `income_received_to_date`, `expense_to_date`, `historical_monthly_income_avg`, `historical_monthly_expense_avg`, and the 10 per-category running totals (`food_dining_to_date` … `personal_transfer_to_date`)
3. Trains and evaluates the expense XGBoost model (MAE, RMSE, R²) with feature importance chart
4. Trains and evaluates the income XGBoost model
5. Demonstrates the overspend risk score formula
6. Saves both models to `../backend_api/storage/models/`

> **Feature consistency:** The 15 feature names used in the notebook must exactly match `PREDICTION_FEATURES` in `backend_api/app/services/model_service.py`. Any mismatch will cause a `feature_names mismatch` error at inference time.

Both notebooks must be run before starting the backend for the first time.

> **Automated alternative:** `train_enhanced_models.py` runs the same training pipeline non-interactively (no Jupyter required). Useful for CI or server environments: `python train_enhanced_models.py`

---

## Generated Outputs

After running both notebooks:

| File | Description |
|---|---|
| `../backend_api/storage/models/smartspend_category_model.joblib` | Trained TF-IDF + LR categorisation pipeline |
| `../backend_api/storage/models/smartspend_expense_prediction_model.joblib` | Trained XGBoost expense model |
| `../backend_api/storage/models/smartspend_income_prediction_model.joblib` | Trained XGBoost income model |

---

## Notebook Contents

### `01_categorisation_model.ipynb`

| Section | Content |
|---|---|
| Setup | Imports, path configuration, output directory creation |
| Data loading | Load CSV, inspect shape, sample rows, class distribution |
| Data quality | Missing values, duplicates, class balance check |
| Feature engineering | Filter to OUTGOING transactions, build `description` text features |
| Visualisations | Category distribution bar chart, amount distributions, SMS text length histogram |
| Model training | TF-IDF + LR pipeline, 5-fold CV with macro-averaged metrics |
| Evaluation | Hold-out accuracy, precision, recall, F1, confusion matrix heatmap |
| Save | Full-dataset retrain and joblib save |

### `02_prediction_model.ipynb`

| Section | Content |
|---|---|
| Setup | Imports, path configuration |
| Data loading | Load CSV, inspect feature columns |
| Data quality | Missing values, feature range checks |
| Visualisations | Feature distributions, category total correlations, heatmap |
| Expense model | XGBoost training, MAE/RMSE/R² evaluation, feature importance chart |
| Income model | XGBoost training, MAE/RMSE/R² evaluation |
| Risk score | Overspend risk score formula demonstration |
| Save | joblib save for both models |

---

## Alignment with Research Proposal

- The categorisation model uses TF-IDF + Logistic Regression as specified in Section 3.6.1.
- The prediction model uses XGBoost as specified in Section 3.6.2.
- 5-fold cross-validation is applied as referenced in Section 3.5.
- User corrections are merged with the base dataset at 3× weight to amplify personalisation, as described in Section 3.4.1.
- No real user data is included in either dataset; both are synthetic and contain no PII.
- The MTN-only scope of the initial dataset is an implementation-phase decision; Airtel Money formats are supported in the SMS parser and datasets can be extended in a future iteration.
