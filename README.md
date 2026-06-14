# SmartSpend

Android-based personal finance management system for Rwandan youth. SmartSpend eliminates manual expense logging by automatically parsing MTN Mobile Money and Airtel Money SMS notifications, extracting line items from receipt images, and applying machine learning to categorise spending and forecast end-of-month financial outcomes.

Built as a BSc. Software Engineering capstone project — African Leadership University, 2026.

---

## What the system does

1. **SMS parsing** — reads MTN MoMo and Airtel Money SMS messages from the user's Android inbox and extracts structured transaction records (amount, fee, counterpart, timestamp, direction).
2. **Expense categorisation** — classifies each outgoing transaction into one of 10 fixed Rwanda-context categories using a TF-IDF + Logistic Regression model that improves over time from user corrections.
3. **Income tracking** — classifies incoming transactions (peer transfers, bank disbursements) separately so the system maintains a full cash-flow picture.
4. **Receipt OCR** — extracts line items from uploaded receipt images via Google Cloud Vision.
5. **Month-end prediction** — uses an XGBoost model to forecast total income and expense at month-end and outputs an overspend risk score (0–100).
6. **Spending status** — a single API call returns the current month's income/expense ratio, top spending category, linear projection, risk level, and a plain-language call to action for the mobile dashboard.

---

## Repository structure

```
SmartSpend-initial-solution/
│
├── backend_api/          FastAPI backend — REST API, ML serving, SMS parsing, OCR, retraining
│   └── README.md         Setup, architecture, all endpoints, auth modes, environment variables
│
├── ml/                   Model training — Jupyter notebooks, datasets, trained model artefacts
│   └── README.md         Dataset specs, model descriptions, notebook structure, analysis workflow
│
└── UI_design/            (Reserved for Android app design assets)
```

---

## Technology stack

| Layer | Technology |
|---|---|
| Mobile (planned) | React Native — Android |
| Backend API | Python 3.11 · FastAPI · uvicorn |
| Authentication | Supabase Auth (JWT) / mock for development |
| Database | SQLite (pilot) → PostgreSQL (production) |
| ML — categorisation | scikit-learn · TF-IDF + Logistic Regression |
| ML — prediction | XGBoost |
| OCR | Google Cloud Vision API |
| HTTP client | httpx |

---

## Getting started

### Prerequisites

- Python 3.11 or newer
- pip
- Git

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd SmartSpend-initial-solution
```

### 2. Train the ML models

The backend requires pre-trained model files before it can categorise transactions or make predictions. Train them first.

```bash
cd ml
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
jupyter notebook
```

In Jupyter, open and run **`01_categorisation_model.ipynb`** first, then **`02_prediction_model.ipynb`**. Both notebooks save trained model files directly to `backend_api/storage/models/`.

### 3. Start the backend API

```bash
cd ../backend_api
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`.
Interactive documentation (Swagger UI): `http://127.0.0.1:8000/docs`

### 4. Test a quick SMS sync

With the server running, send a test request:

```bash
curl -X POST http://127.0.0.1:8000/transactions/sms/sync \
  -H "Content-Type: application/json" \
  -d '{
    "consent_confirmed": true,
    "raw_sms_messages": [
      "MoMo: RWF 3500 paid to Bourbon Coffee Kigali. Transaction MM100141. Remaining balance RWF 224500.",
      "You have received RWF 50000 from INSHUTI Alice. Tx MM900121. Balance RWF 85000."
    ]
  }'
```

In development mode (`MOCK_AUTH_ENABLED=true`), no Authorization header is required — all requests resolve to the configured `MOCK_USER_ID`.

---

## Detailed documentation

Full setup instructions, all endpoint references, environment variable descriptions, and auth configuration are in the per-package README files:

- Backend API → [backend_api/README.md](backend_api/README.md)
- ML notebooks → [ml/README.md](ml/README.md)

Android-based personal finance management system for Rwandan youth. SmartSpend eliminates manual expense logging by automatically parsing MTN Mobile Money and Airtel Money SMS notifications, extracting line items from receipt images, and applying machine learning to categorise spending and forecast end-of-month financial outcomes.

Built as a BSc. Software Engineering capstone project — African Leadership University, 2026.

---

## What the system does

1. **SMS parsing** — reads MTN MoMo and Airtel Money SMS messages from the user's Android inbox and extracts structured transaction records (amount, fee, counterpart, timestamp, direction).
2. **Expense categorisation** — classifies each outgoing transaction into one of 10 fixed Rwanda-context categories using a TF-IDF + Logistic Regression model that improves over time from user corrections.
3. **Income tracking** — classifies incoming transactions (peer transfers, bank disbursements) separately so the system maintains a full cash-flow picture.
4. **Receipt OCR** — extracts line items from uploaded receipt images via Google Cloud Vision.
5. **Month-end prediction** — uses an XGBoost model to forecast total income and expense at month-end and outputs an overspend risk score (0–100).
6. **Spending status** — a single API call returns the current month's income/expense ratio, top spending category, linear projection, risk level, and a plain-language call to action for the mobile dashboard.

---

## Repository structure

```
SmartSpend-initial-solution/
│
├── backend_api/          FastAPI backend — REST API, ML serving, SMS parsing, OCR, retraining
│   └── README.md         Setup, architecture, all endpoints, auth modes, environment variables
│
├── ml/                   Model training — Jupyter notebooks, datasets, trained model artefacts
│   └── README.md         Dataset specs, model descriptions, notebook structure, analysis workflow
│
└── UI_design/            (Reserved for Android app design assets)
```

---

## Technology stack

| Layer | Technology |
|---|---|
| Mobile (planned) | React Native — Android |
| Backend API | Python 3.11 · FastAPI · uvicorn |
| Authentication | Supabase Auth (JWT) / mock for development |
| Database | SQLite (pilot) → PostgreSQL (production) |
| ML — categorisation | scikit-learn · TF-IDF + Logistic Regression |
| ML — prediction | XGBoost |
| OCR | Google Cloud Vision API |
| HTTP client | httpx |

---

## Quick start

### Backend

```bash
cd backend_api
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Swagger UI: `http://127.0.0.1:8000/docs`

Full setup, environment variables, and endpoint reference → [backend_api/README.md](backend_api/README.md)

### ML notebooks

```bash
cd ml
pip install -r requirements.txt
jupyter notebook
```

Run `01_categorisation_model.ipynb` first, then `02_prediction_model.ipynb`. Both save trained models directly to `backend_api/storage/models/`.

Dataset specs, notebook structure, and visualisation descriptions → [ml/README.md](ml/README.md)

---
