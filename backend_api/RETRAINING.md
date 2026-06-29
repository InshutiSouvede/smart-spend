# SmartSpend — Personalised ML Retraining Design

## Overview

Every authenticated user in SmartSpend has an **independent, isolated model pipeline**.
No user's data is ever used to train another user's model, and no global model is
retrained from real user data. The shared synthetic base models exist solely as a
cold-start fallback.

---

## Model Types

| Model | Algorithm | Purpose |
|-------|-----------|---------|
| `expense_category` | TF-IDF (1-2 gram, 5 000 features) + LogisticRegression (balanced, C=1.0) | Classify purchase items into one of 10 expense categories |
| `monthly_expense_forecast` | XGBoost Regressor (150 trees, max_depth=4) | Predict month-end total expense from mid-month features |
| `monthly_income_forecast` | XGBoost Regressor (150 trees, max_depth=4) | Predict month-end total income from mid-month features |

---

## Artifact Storage Layout

```
storage/
  models/
    smartspend_category_model.joblib              ← shared synthetic base (read-only)
    smartspend_expense_prediction_model.joblib    ← shared synthetic base (read-only)
    smartspend_income_prediction_model.joblib     ← shared synthetic base (read-only)
    users/
      {user_id}/
        category_model.joblib                     ← personalised category model
        expense_forecast_model.joblib             ← personalised expense forecast
        income_forecast_model.joblib              ← personalised income forecast
```

The `storage/models/users/{user_id}/` directory is created on first retraining for
that user. The directory is owned by the server process and is never served via HTTP.

---

## Inference: Base-Model Fallback

At inference time `ModelService._resolve_model()` follows this priority:

1. Look for `storage/models/users/{user_id}/{model_type}.joblib`.
2. If present and loadable → use it, return `model_scope = "user_personalised"`.
3. Otherwise → fall back to the shared synthetic base model, return `model_scope = "base_synthetic"`.

All categorisation and forecast responses include a `model_scope` field so the
client can indicate to the user whether a personalised model is in use.

---

## Training Data Sources (Category Model)

Training rows are assembled in three tiers, each with a distinct weight that
reflects how strongly the example should influence the model:

| Source | Weight | Description |
|--------|--------|-------------|
| Shared synthetic seed CSV | 1.0 | Cold-start foundation (`data/smartspend_initial_expense_category_classification_demo_dataset.csv`). Never contains real user data. |
| User's enriched purchase records | 1.5 – 2.5 | `purchase_details` rows for *this user only* that have a `final_category` assigned but were not submitted as an explicit correction. Receipt-derived items matched by the user score 2.5; receipt-derived auto-matched score 2.0; user-prompt items confirmed by the user score 2.0; auto-matched items score 1.5. |
| User's explicit category corrections | 3.0 | Rows stored in `category_corrections` for *this user only*. Highest weight because they represent a direct signal that the model was wrong. |

**Isolation guarantee:** all SQL queries in `retrain_category_model()` carry a
`WHERE user_id = ?` predicate. No join can accidentally pull in another user's rows.

---

## Training Data Sources (Forecast Models)

Both the expense and income forecast models are trained on
`monthly_financial_aggregates` rows for the requesting user only:

```sql
SELECT year, month, category, total_expense_rwf, total_income_rwf
FROM monthly_financial_aggregates
WHERE user_id = ?
```

**Cold-start rule:** if the user has fewer than 3 months of relevant data, the
model falls back to the synthetic seed CSV
(`data/smartspend_initial_synthetic_prediction_demo_dataset.csv`).

---

## Retraining Triggers

### Manual — via API

Any authenticated user can request retraining at any time:

```
POST /models/category/retrain
POST /models/expense-forecast/retrain
POST /models/income-forecast/retrain
```

The job is queued as a FastAPI `BackgroundTask`; the response returns a `job_id`
immediately. Poll `GET /models/jobs/{job_id}` for status.

### Automatic — on category corrections

When the user submits a category correction (`POST /transactions/corrections`):

1. The correction is always saved immediately.
2. The total correction count for the user is evaluated.
3. If `total_corrections % min_corrections_for_retraining == 0` (default threshold: **5**)
   **and** no job is already queued or running for this user, retraining is queued
   automatically.
4. If `trigger_retraining=true` is set in the request body, retraining is also
   queued regardless of the threshold.

The threshold is configured via:
```
MIN_CORRECTIONS_FOR_RETRAINING=5  # in .env or environment
```

---

## Retraining Job Lifecycle

Each job is tracked in the `retraining_jobs` table:

| Status | Meaning |
|--------|---------|
| `queued` | Job created, not yet started |
| `running` | Background task is active |
| `completed` | Model saved successfully |
| `failed` | Exception; see `error_message` |

After a job reaches `completed`, a row is inserted in `model_versions` with:

- `version` — incrementing integer per `(user_id, model_type)`
- `model_path` — absolute path to the saved `.joblib` file
- `metrics_json` — accuracy, F1, CV scores, training row counts
- `is_active = 1` — the latest version (all previous versions are set to 0)
- `retraining_job_id` — foreign key back to `retraining_jobs`

---

## Model Version API

```
GET /models/versions                          # all model versions for current user
GET /models/versions?model_type=expense_category
```

Returns a list of `ModelVersionOut` objects, newest first, with `is_active` flagging
the currently loaded artifact.

---

## Privacy & Isolation Guarantees

- **No cross-user training:** every DB query in `retraining_service.py` is scoped
  by `user_id`.
- **No global retraining from real data:** the shared base models are trained offline
  on the synthetic seed CSV and shipped as static files. The API never updates them.
- **No LLMs in inference or retraining:** all inference is local sklearn/XGBoost.
- **Artifact isolation:** user model files are stored in per-user subdirectories.
  There is no endpoint that serves a `.joblib` file directly; model paths are
  internal server paths, never exposed to clients.

---

## Running a Retraining Job Manually (development)

```bash
# Start the server
cd backend_api
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Trigger category retraining (mock auth returns demo_user_001)
curl -X POST http://127.0.0.1:8000/models/category/retrain

# Poll job status (replace 1 with the returned job_id)
curl http://127.0.0.1:8000/models/jobs/1

# List model versions
curl http://127.0.0.1:8000/models/versions
```

The first run for a new user will use only the synthetic base dataset because no
user data exists yet. Subsequent runs will progressively incorporate real data with
higher weights.
