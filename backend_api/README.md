# SmartSpend Backend API

FastAPI backend for the SmartSpend personal finance management system, as described in the BSc. capstone research proposal. The backend handles MTN Mobile Money and Airtel Money SMS parsing, ML-based expense categorisation, XGBoost month-end financial prediction, receipt OCR, and asynchronous per-user model retraining.

---

## Architecture Overview

```
SmartSpend Backend
│
├── app/
│   ├── main.py                    Entry point — FastAPI app, middleware, startup
│   ├── api/
│   │   ├── __init__.py            APIRouter aggregator
│   │   ├── auth.py                Register, logout, identity, user profile
│   │   ├── transactions.py        SMS sync, transaction list/get, category edit, corrections
│   │   ├── models.py              Categorise, predict, retrain, job list/status
│   │   ├── receipts.py            Receipt upload, list, get
│   │   └── analytics.py          Summary, monthly trends, category breakdown, spending status
│   ├── core/
│   │   ├── config.py              Pydantic-Settings environment configuration
│   │   ├── database.py            SQLite connection, schema init, migrations
│   │   ├── auth.py                JWT verification (Supabase) / mock auth
│   │   ├── logging_config.py      Structured console logging setup
│   │   └── exceptions.py         Custom exception types and handlers
│   ├── schemas/
│   │   └── schemas.py             Pydantic request/response models
│   └── services/
│       ├── sms_parser.py          MoMo SMS parsing (MTN + Airtel)
│       ├── model_service.py       ML model loading and inference
│       ├── retraining_service.py  Background retraining jobs (TF-IDF+LR, XGBoost)
│       └── ocr_service.py        Receipt OCR (Google Vision / mock)
├── data/
│   ├── smartspend_initial_synthetic_momo_sms_dataset.csv
│   └── smartspend_initial_synthetic_prediction_demo_dataset.csv
├── storage/
│   ├── models/                    Base ML model files (.joblib)
│   ├── user_models/               Per-user personalised model files
│   ├── uploads/                   Uploaded receipt images (per user_id subdirectory)
│   └── retraining_jobs/           (Reserved for job artefacts)
├── .env.example
├── requirements.txt
└── README.md
```

---

## Setup Instructions

### Prerequisites
- Python 3.11+
- pip
- Trained model files in `storage/models/` (run the ML notebooks first — see [ml/README.md](../ml/README.md))

### Installation

```bash
cd backend_api
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

### Running the server

```bash
uvicorn app.main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.

---

## API Documentation

Interactive Swagger UI:

```
http://127.0.0.1:8000/docs
```

ReDoc:

```
http://127.0.0.1:8000/redoc
```

---

## Environment Variables

All variables are documented in `.env.example`. Key variables:

| Variable | Default | Description |
|---|---|---|
| `APP_ENV` | `development` | Runtime environment |
| `DATABASE_PATH` | `./smartspend.db` | SQLite database file path |
| `MOCK_AUTH_ENABLED` | `true` | Bypass JWT verification for local development |
| `MOCK_USER_ID` | `demo_user_001` | User ID returned in mock auth mode |
| `SUPABASE_JWT_SECRET` | — | Required when `MOCK_AUTH_ENABLED=false` |
| `CORS_ORIGINS` | localhost ports | Comma-separated list of allowed CORS origins |
| `GOOGLE_VISION_ENABLED` | `false` | Enable Google Cloud Vision OCR |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to Google service account JSON |
| `MIN_CORRECTIONS_FOR_RETRAINING` | `5` | Minimum corrections before retraining |

---

## API Endpoints

### System
| Method | Path | Description |
|---|---|---|
| GET | `/health` | API health check |

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user account |
| POST | `/auth/logout` | Invalidate the current session |
| GET | `/auth/me` | Current user identity and auth mode |
| GET | `/auth/profile` | Get the current user's display name and email |
| PATCH | `/auth/profile` | Update the current user's display name |

### Transactions
| Method | Path | Description |
|---|---|---|
| POST | `/transactions/sms/sync` | Parse and store MoMo SMS messages |
| GET | `/transactions/` | List transactions (paginated, filterable) |
| GET | `/transactions/{id}` | Get a single transaction |
| PATCH | `/transactions/{id}/category` | Update a transaction's category inline |
| POST | `/transactions/corrections` | Submit a category correction |

### Models
| Method | Path | Description |
|---|---|---|
| GET | `/models/category/categories` | List all supported expense categories |
| POST | `/models/category/predict` | Categorise a transaction description |
| POST | `/models/category/retrain` | Trigger category model retraining |
| POST | `/models/prediction/predict` | Predict month-end expense/income and risk score |
| POST | `/models/prediction/retrain` | Trigger prediction model retraining |
| GET | `/models/retraining/` | List all retraining jobs for the current user |
| GET | `/models/retraining/{job_id}` | Check a specific retraining job status |

### Receipts
| Method | Path | Description |
|---|---|---|
| POST | `/receipts/upload` | Upload a receipt image (multipart/form-data) |
| GET | `/receipts/` | List uploaded receipts |
| GET | `/receipts/{id}` | Get a receipt with parsed line items |

### Analytics
| Method | Path | Description |
|---|---|---|
| GET | `/analytics/spending-status` | Home dashboard payload — risk level, projection, call to action |
| GET | `/analytics/summary` | Income/expense summary for a date range |
| GET | `/analytics/monthly` | Monthly income/expense trends |
| GET | `/analytics/categories` | Category-level expense breakdown |

---

## Authentication

### Development mode

```env
MOCK_AUTH_ENABLED=true
MOCK_USER_ID=demo_user_001
```

All requests resolve to `MOCK_USER_ID` without requiring a token. This is the default for local development.

### Production mode (Supabase)

```env
MOCK_AUTH_ENABLED=false
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
```

With mock auth disabled, every protected request must include a valid Supabase JWT:

```
Authorization: Bearer <supabase_access_token>
```

---

## SMS Parser

The parser supports the following MTN MoMo and Airtel Money transaction types:

| Type | Direction | Example trigger |
|---|---|---|
| `MERCHANT_PAYMENT` | OUTGOING | "Your payment of X RWF to MERCHANT" |
| `MERCHANT_PAYMENT` | OUTGOING | "A transaction of X RWF by MERCHANT" |
| `PEER_TRANSFER` | OUTGOING | "X RWF transferred to NAME (PHONE)" |
| `CASH_WITHDRAWAL` | OUTGOING | "withdrawn X RWF via agent: NAME" |
| `BANK_TRANSFER` | OUTGOING | "Your transfer of X RWF to BANK account" |
| `PEER_TRANSFER_RECEIVED` | INCOMING | "You have received X RWF from NAME" |
| `BANK_TRANSFER_RECEIVED` | INCOMING | "received … B2C / Equity / BK" |

Each parsed transaction includes: `amount_rwf`, `fee_rwf`, `total_amount_rwf`, `balance_after_rwf`, `counterpart_name`, `timestamp`, and `direction`.

To support a new SMS format, add a `_try_*` function to `services/sms_parser.py` and register it in `_PARSERS`.

---

## OCR Integration

Receipt OCR defaults to mock mode (returns static text for end-to-end testing without consuming Google Vision quota).

To enable real OCR:

```env
GOOGLE_VISION_ENABLED=true
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json
```

Install the additional dependency:

```bash
pip install google-cloud-vision==3.7.2
```

---

## Expense Categories

The system uses 10 fixed expense categories (returned by `GET /models/category/categories`):

- Food & Dining
- Transport
- Groceries
- Communication
- Education
- Utilities
- Health
- Entertainment
- Savings & Investments
- Personal Transfer

---

## Example Requests

### Sync SMS messages

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

### Get spending status (home dashboard)

```bash
curl http://127.0.0.1:8000/analytics/spending-status
```

### Update a transaction category

```bash
curl -X PATCH http://127.0.0.1:8000/transactions/1/category \
  -H "Content-Type: application/json" \
  -d '{"category": "Food & Dining", "trigger_retraining": false}'
```

---

## Development Workflow

1. Run the ML notebooks to generate model files in `storage/models/` (one-time step).
2. Start the server: `uvicorn app.main:app --reload`
3. Test via Swagger UI at `/docs`.
4. To test SMS parsing, call `POST /transactions/sms/sync`.
5. To trigger and monitor retraining: `POST /models/category/retrain`, then poll `GET /models/retraining/{job_id}`.
6. To list all your retraining jobs: `GET /models/retraining/`
