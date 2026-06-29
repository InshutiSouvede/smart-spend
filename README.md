# SmartSpend

Android-based personal finance management system for Rwandan youth. SmartSpend eliminates manual expense logging by automatically parsing MTN Mobile Money and Airtel Money SMS notifications, extracting line items from receipt images, and applying machine learning to categorise spending and forecast end-of-month financial outcomes.

Built as a BSc. Software Engineering capstone project — African Leadership University, 2026.

---

## Table of contents

1. [Architecture](#architecture)
2. [Repository structure](#repository-structure)
3. [Prerequisites](#prerequisites)
4. [Environment variables](#environment-variables)
5. [Supabase setup](#supabase-setup)
6. [Backend setup](#backend-setup)
7. [ML setup](#ml-setup)
8. [Frontend setup](#frontend-setup)
9. [PaddleOCR setup](#paddleocr-setup)
10. [Android permissions](#android-permissions)
11. [How SMS import works](#how-sms-import-works)
12. [How receipt matching works](#how-receipt-matching-works)
13. [How per-user retraining works](#how-per-user-retraining-works)
14. [Dashboard and features](#dashboard-and-features)
15. [CSV export](#csv-export)
16. [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Android App (React Native / Expo SDK 52)               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Dashboard · Analytics · Transactions · Receipts │   │
│  │  Export · Profile                                │   │
│  └──────────────────────────────────────────────────┘   │
│                       ▼ HTTP/REST                       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  FastAPI backend (Python 3.11)                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ /auth   │  │ /txns    │  │/analytics│  │/models │  │
│  │ /rcpts  │  │ SMS sync │  │ spending │  │ categ. │  │
│  └─────────┘  └──────────┘  └──────────┘  └────────┘  │
│       ▼ sqlite3              ▼ joblib models           │
│  SQLite DB              ML service layer               │
│  (init on startup)      (TF-IDF + LR, XGBoost)        │
└─────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- No ORM — raw `sqlite3` with `CREATE TABLE IF NOT EXISTS` migrations via `_run_migrations()` on startup.
- Auth is switchable: `MOCK_AUTH_ENABLED=true` bypasses JWT for local development; `false` validates Supabase Bearer tokens.
- ML models stored as `.joblib` files under `storage/models/`. Per-user fine-tuned models go in `storage/models/users/{user_id}/`.
- SMS parsing uses regex patterns with provider detection (MTN vs Airtel). No external NLP.
- Receipt OCR uses PaddleOCR running locally — no cloud API key required.

---

## Repository structure

```
smart-spend/
├── backend_api/            FastAPI backend
│   ├── app/
│   │   ├── api/            Route handlers (auth, transactions, analytics, models, receipts)
│   │   ├── core/           Config, DB connection, auth middleware, logging
│   │   ├── schemas/        Pydantic v2 request/response models
│   │   └── services/       SMS parser, OCR, ML model service, retraining service
│   ├── data/               Seed CSV files for model training
│   ├── storage/            Models (.joblib), uploads, retraining jobs
│   └── requirements.txt
├── frontend/               React Native / Expo mobile app
│   ├── src/
│   │   ├── api/            Axios API clients (analytics, auth, models, receipts, transactions)
│   │   ├── components/     TransactionCard, ReceiptCard, CategoryPicker, ErrorBanner, LoadingOverlay
│   │   ├── hooks/          React Query hooks (useAnalytics, useTransactions, useReceipts, useModels, useProfile)
│   │   ├── navigation/     RootNavigator, AuthStack, AppTabs (6 tabs)
│   │   ├── screens/        HomeScreen, AnalyticsScreen, TransactionsScreen, ReceiptsScreen,
│   │   │                   ExportScreen, SMSImportScreen, LoginScreen, SignupScreen, ProfileScreen
│   │   ├── services/       SMS reader service
│   │   ├── store/          Zustand auth store
│   │   └── types/          Shared API type definitions
│   └── package.json
├── ml/                     Jupyter notebooks for model training
│   ├── 01_categorisation_model.ipynb
│   ├── 02_prediction_model.ipynb
│   └── SmartSpend_Model_Training_Notebook.ipynb
└── storage/                Shared storage root (models, uploads)
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | ≥ 3.11 | Backend + ML notebooks |
| Node.js | ≥ 20 LTS | Frontend |
| npm | ≥ 10 | Package manager |
| Java JDK | 17 | Android build |
| Android Studio | Latest | Android SDK, emulator |
| Expo CLI | Included with npm | Start dev server |
| Git | Any | Version control |

Optional: Supabase project (only needed when `MOCK_AUTH_ENABLED=false`).

---

## Environment variables

### Backend — `backend_api/.env`

```env
# ── Auth ──────────────────────────────────────────────────────
MOCK_AUTH_ENABLED=true          # true = skip JWT, use MOCK_USER_ID
MOCK_USER_ID=demo_user_001      # user_id used in mock mode
SUPABASE_JWT_SECRET=            # required when MOCK_AUTH_ENABLED=false

# ── App ───────────────────────────────────────────────────────
APP_ENV=development
SECRET_KEY=change-me-in-production

# ── Storage ───────────────────────────────────────────────────
STORAGE_ROOT=../storage         # relative to backend_api/
DATABASE_PATH=../storage/smartspend.db

# ── OCR ───────────────────────────────────────────────────────
PADDLE_OCR_ENABLED=true         # false = mock OCR text
PADDLE_OCR_USE_ANGLE_CLS=false
PADDLE_OCR_LANG=en

# ── Receipt matching ──────────────────────────────────────────
RECEIPT_MATCH_AMOUNT_TOLERANCE=0.10
RECEIPT_MATCH_TIME_WINDOW_SECONDS=7200
RECEIPT_MATCH_MIN_CONFIDENCE=0.65

# ── ML retraining ─────────────────────────────────────────────
MIN_CORRECTIONS_FOR_RETRAINING=5

# ── CORS ──────────────────────────────────────────────────────
CORS_ORIGINS=["http://localhost:8081","http://127.0.0.1:8081"]
```

### Frontend — `frontend/.env` (or `frontend/app.config.js`)

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:8000   # Android emulator → host machine
# EXPO_PUBLIC_API_URL=http://127.0.0.1:8000  # iOS simulator or web
# EXPO_PUBLIC_API_URL=https://your-server    # production
```

> **Note:** `10.0.2.2` is the Android emulator's alias for the host machine's `localhost`.

---

## Supabase setup

Only required when `MOCK_AUTH_ENABLED=false`.

1. Create a project at [supabase.com](https://supabase.com).
2. Under **Settings → API**, copy the **JWT Secret**.
3. Set `SUPABASE_JWT_SECRET=<your-jwt-secret>` in `backend_api/.env`.
4. In the frontend, use the Supabase JS client to sign in and pass the `access_token` as a `Bearer` header.

When `MOCK_AUTH_ENABLED=true` (default for local dev), no Supabase project is needed — the backend automatically assigns `MOCK_USER_ID` to every request.

---

## Backend setup

```bash
cd backend_api

# 1. Create and activate virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create environment file (see Environment variables above)
copy .env.example .env    # edit as needed

# 4. Start the API server
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The server starts on **http://127.0.0.1:8000**. Interactive docs available at **/docs**.

The SQLite database is created automatically at `storage/smartspend.db` on first startup. No migration tool is needed — `init_db()` runs `CREATE TABLE IF NOT EXISTS` and `_run_migrations()` handles schema additions safely.

### Verify

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok","environment":"development","version":"...","mock_auth_enabled":true}
```

---

## ML setup

The pre-trained models in `backend_api/storage/models/` are used automatically on startup. To retrain from scratch using the seed datasets:

```bash
cd ml

# Create virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1   # or source .venv/bin/activate

# Install ML dependencies
pip install -r requirements.txt

# Launch Jupyter and open the notebooks
jupyter lab
```

Open and run in order:
1. `01_categorisation_model.ipynb` — trains the TF-IDF + Logistic Regression expense category classifier.
2. `02_prediction_model.ipynb` — trains the XGBoost expense and income forecast models.

Trained model files (`.joblib`) and metrics (`.json`) are written to `ml/smartspend_initial_models/`. Copy them to `backend_api/storage/models/` to use them in the backend.

---

## Frontend setup

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Set API URL
# Create a .env file:
echo "EXPO_PUBLIC_API_URL=http://10.0.2.2:8000" > .env

# 3. Start Expo development server
npx expo start

# 4a. Run on Android emulator (press 'a' in the Expo CLI)
# 4b. Run on physical Android device (scan QR code with Expo Go)
# 4c. Build a dev client for native module support (SMS reading):
npx expo run:android
```

> **SMS reading** (`react-native-get-sms-android`) requires an EAS dev build or `expo run:android`. It degrades gracefully in Expo Go (the SMS import screen skips device SMS reading and accepts manual JSON input).

### Tabs (navigation)

| Tab | Screen | Purpose |
|-----|--------|---------|
| Dashboard | `HomeScreen` | Monthly summary, risk badge, ML predictions, spending trend chart, recent transactions |
| Analytics | `AnalyticsScreen` | Category breakdown, monthly comparison chart, spending trends |
| Transactions | `TransactionsScreen` | Full transaction list with category correction |
| Receipts | `ReceiptsScreen` | Receipt history and match status |
| Export | `ExportScreen` | CSV export with date range and type filter |
| Profile | `ProfileScreen` | Display name, sign out |

---

## PaddleOCR setup

PaddleOCR runs locally on the server machine — no API key or internet connection needed after initial model download.

```bash
# In the backend virtual environment:
pip install paddlepaddle paddleocr

# PaddleOCR downloads its OCR models (~100MB) automatically on first use.
# Set in .env:
PADDLE_OCR_ENABLED=true
```

To disable OCR (returns mock extracted text):
```env
PADDLE_OCR_ENABLED=false
```

Supported upload formats: JPEG, PNG, WebP, PDF. Images are automatically resized to ≤ 4096px before processing.

---

## Android permissions

Add to `frontend/android/app/src/main/AndroidManifest.xml`:

```xml
<!-- SMS reading -->
<uses-permission android:name="android.permission.READ_SMS" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />

<!-- Internet -->
<uses-permission android:name="android.permission.INTERNET" />

<!-- Camera (for receipt upload) -->
<uses-permission android:name="android.permission.CAMERA" />

<!-- Storage (for receipt images) -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

> **Privacy:** The app requests SMS permission only after the user explicitly taps "Import SMS" and confirms a consent dialog. No SMS data is transmitted without user confirmation. Messages containing security-sensitive keywords (OTP, PIN, passcode) are detected client-side and never stored.

---

## How SMS import works

1. User taps **Import SMS** on the Transactions tab.
2. The app reads SMS messages from the Android inbox (via `react-native-get-sms-android`), filtering for known MoMo/Airtel senders.
3. A consent dialog lists the messages to be uploaded. User must confirm.
4. The app calls `POST /transactions/sms/sync` with the batch.
5. **Server-side:**
   - Each message is checked for sensitive keywords (OTP, PIN, passcode) — flagged messages are not stored and returned in `sensitive_warnings`.
   - Valid messages are parsed by regex patterns recognising MTN MoMo and Airtel Money formats.
   - Parsed transactions are deduplicated by: `source_message_id` → `transaction_reference` → hash+time+amount.
   - New expense transactions are automatically matched against existing `purchase_details` (if a receipt was uploaded before the SMS).
   - Monthly aggregate tables are refreshed.
6. The app displays a summary: imported / duplicates skipped / failed / sensitive warnings.

---

## How receipt matching works

1. User taps **Upload Receipt** on the Receipts tab and selects an image.
2. The app calls `POST /receipts/upload` with the image file.
3. **Server-side:**
   - Magic-byte validation confirms the file is a valid JPEG/PNG/WebP/PDF.
   - PaddleOCR extracts text from the image.
   - `parse_receipt_header()` extracts merchant name, total amount (RWF), and timestamp.
   - `parse_receipt_items()` extracts line items with quantities and costs.
   - The system searches for a matching SMS expense transaction using a weighted score:
     - Amount similarity: 50% weight (tolerance: ±10%)
     - Time proximity: 35% weight (window: ±2 hours)
     - Merchant name similarity: 15% weight
   - A match above 0.65 confidence is created automatically. The user can manually link/unlink receipts via `POST /receipts/{id}/link`.

---

## How per-user retraining works

SmartSpend personalises the expense category model for each user.

1. When a user corrects a category (taps **Fix** on a TransactionCard and selects the right category), the correction is stored in `category_corrections`.
2. After every 5 corrections (configurable via `MIN_CORRECTIONS_FOR_RETRAINING`), a background retraining job is automatically queued.
3. The retrain merges three data sources with different weights:
   - Seed synthetic dataset: weight 1.0
   - Enriched receipt/prompt data: weight 1.5–2.5
   - User corrections: weight 3.0 (highest priority)
4. The new model is saved to `storage/models/users/{user_id}/expense_category.joblib` and the `model_versions` table is updated.
5. All subsequent category predictions for that user use their personalised model.

Model versions are tracked in the `model_versions` table. Query `GET /models/versions` to see the current active model for a user.

---

## Dashboard and features

### Dashboard (HomeScreen)

- **Risk badge**: Low / Watch out / High risk based on expense-to-income ratio
  - < 60%: Low risk (green)
  - 60–85%: Watch out (amber)
  - \> 85%: High risk (red)
- **Income and expense cards**: Current month totals from SMS transactions
- **Net balance**: Income − expenses with plain-language status message
- **Spending rate progress bar**: Visual indicator of budget usage
- **ML Forecast**: XGBoost model predictions for month-end income and expense (shown when a trained model is available)
- **Top spending category**: Highlighted with amount and percentage
- **Spending trend chart**: Line chart showing income vs expense for the last 4 months
- **Unmatched expenses alert**: Tappable banner when expense transactions need categorisation
- **Recent activity**: Last 5 transactions inline

### Analytics (AnalyticsScreen)

- Category breakdown bar chart with item-level amounts
- Category list with percentages
- Monthly expense bar chart (1 / 3 / 6 / 12 month selector)
- Monthly comparison table (income, expense, net per month)
- Export link to CSV

### Category correction

On the Transactions tab, expense transactions with linked purchase items show a **Fix** button. Tapping it opens a bottom sheet category picker. Selecting a new category calls `POST /transactions/corrections`, updates `expense_categories`, and may trigger background model retraining.

---

## CSV export

On the **Export** tab:
1. Select a date range (YYYY-MM-DD inputs).
2. Filter by type: All / Income / Expense.
3. Tap **Export to CSV**.
4. The app calls `GET /transactions/export/csv` with auth headers.
5. The CSV text is shared via the Android share sheet (save to Files, email, WhatsApp, etc.).

**CSV columns:** `date, type, amount_rwf, fee_rwf, to_who, from_who, reference, provider, balance_after_rwf, currency, parse_confidence`

---

## Troubleshooting

### Backend won't start

```bash
# Missing .env — copy from the example:
copy backend_api\.env.example backend_api\.env
# If no example exists, create it with at minimum:
# MOCK_AUTH_ENABLED=true

# Wrong working directory — always run from backend_api/:
cd backend_api
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### `ModuleNotFoundError` on startup

```bash
# Activate the virtual environment first:
backend_api\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### PaddleOCR install fails on Windows

```bash
# Install CPU-only PaddlePaddle (smaller, no CUDA required):
pip install paddlepaddle -f https://www.paddlepaddle.org.cn/whl/windows/mkl/avx/stable.html
pip install paddleocr
```

### Android emulator can't reach the backend

- Use `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000` (not `localhost`).
- Ensure the backend is bound to `0.0.0.0` or `127.0.0.1` (both work from emulator).
- Check Windows Firewall isn't blocking port 8000.

### SMS reading returns no messages

- `react-native-get-sms-android` requires a **dev build** (`npx expo run:android`), not Expo Go.
- Grant SMS permission when prompted on the device.
- In Expo Go, the import screen falls back to manual JSON input for testing.

### TypeScript errors after pull

```bash
cd frontend
npm install
npx expo start --clear
```

### Database schema is out of date

Delete `storage/smartspend.db` and restart the backend — `init_db()` recreates all tables and `_run_migrations()` adds any new columns. **Warning: this clears all data.**

### ML model not found

```bash
# Copy pre-trained models from ml/ to backend_api/storage/models/:
cp ml/smartspend_initial_models/* backend_api/storage/models/
```

If no models are present, the categorisation endpoint returns a 503 and the spending-status endpoint skips ML predictions gracefully.


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
