# SmartSpend

Android personal finance manager for Rwandan youth. SmartSpend automatically parses MTN Mobile Money and Airtel Money SMS notifications, extracts line items from receipt images via OCR, and applies machine learning to categorise spending and forecast month-end financial outcomes.

> BSc. Software Engineering capstone — African Leadership University, 2026 · [Video Presentation](https://shorturl.at/DPoaW)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Repository Structure](#repository-structure)
5. [Prerequisites](#prerequisites)
6. [Setup](#setup)
7. [Configuration](#configuration)
8. [Tesseract OCR Setup](#tesseract-ocr-setup)
9. [Supabase Setup](#supabase-setup)
10. [Android Permissions](#android-permissions)
11. [How It Works](#how-it-works)
12. [App Features](#app-features)
13. [Deployment](#deployment)
14. [Troubleshooting](#troubleshooting)

---

## Overview

1. **SMS parsing** — reads MTN MoMo and Airtel Money SMS from the Android inbox; extracts amount, fee, counterpart, timestamp, and direction.
2. **Expense categorisation** — classifies outgoing transactions into 10 Rwanda-context categories using TF-IDF + Logistic Regression; improves with user corrections.
3. **Receipt OCR** — extracts merchant name, total, and line items from uploaded receipt images using Tesseract (runs locally, no cloud API).
4. **Month-end forecasting** — XGBoost model predicts total income and expense at month-end with an overspend risk score (0–100).
5. **Spending status** — single API call returns the income/expense ratio, top category, risk level, and a plain-language summary for the dashboard.

---

## Architecture

```
+----------------------------------------------------------+
|  Android App (React Native / Expo SDK 52)                |
|    Dashboard . Analytics . Transactions . Receipts       |
|    Export . Profile                                      |
|                       v HTTP/REST                        |
+-----------------------------+----------------------------+
                              |
+-----------------------------v----------------------------+
|  FastAPI backend (Python 3.12)                           |
|  /auth  /transactions  /analytics  /models  /receipts   |
|       v sqlite3                v joblib models           |
|   SQLite DB               ML service layer               |
|   (init on startup)       (TF-IDF + LR, XGBoost)        |
+----------------------------------------------------------+
```

**Key design decisions:**
- No ORM — raw `sqlite3`; schema created via `CREATE TABLE IF NOT EXISTS` and column additions handled by `_run_migrations()` on startup.
- Dual auth mode: `MOCK_AUTH_ENABLED=true` bypasses JWT for local dev; `false` validates Supabase Bearer tokens via JWKS.
- Per-user ML models stored at `storage/models/users/{user_id}/`; global base model at `storage/models/`.
- SMS parsing uses regex with provider detection (MTN vs Airtel) — no external NLP dependencies.
- Tesseract OCR runs locally — lightweight and deployment-friendly.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native · Expo SDK 52 |
| Backend | Python 3.12 · FastAPI · uvicorn |
| Authentication | Supabase Auth (JWT) / mock mode for dev |
| Database | SQLite (dev) → PostgreSQL (production) |
| ML — categorisation | scikit-learn · TF-IDF + Logistic Regression |
| ML — forecasting | XGBoost |
| OCR | Tesseract · pytesseract |

---

## Repository Structure

```
smart-spend/
+-- backend_api/            FastAPI backend
|   +-- app/
|   |   +-- api/            Route handlers (auth, transactions, analytics, models, receipts)
|   |   +-- core/           Config, DB connection, auth middleware, logging
|   |   +-- schemas/        Pydantic v2 request/response models
|   |   +-- services/       SMS parser, OCR, ML inference, retraining
|   +-- data/               Seed CSV files for model training
|   +-- storage/            Models (.joblib), uploads, retraining jobs
|   +-- requirements.txt
+-- frontend/               React Native / Expo app
|   +-- src/
|   |   +-- api/            Axios clients (analytics, auth, models, receipts, transactions)
|   |   +-- components/     TransactionCard, ReceiptCard, CategoryPicker, ErrorBanner
|   |   +-- hooks/          TanStack Query hooks
|   |   +-- navigation/     RootNavigator, AuthStack, AppTabs (6 tabs)
|   |   +-- screens/        Home, Analytics, Transactions, Receipts, Export, SMS Import, Auth, Profile
|   |   +-- services/       SMS reader
|   |   +-- store/          Zustand auth store
|   |   +-- types/          Shared TypeScript types
|   +-- package.json
+-- ml/                     Model training notebooks and datasets
|   +-- 01_categorisation_model.ipynb
|   +-- 02_prediction_model.ipynb
|   +-- requirements.txt
+-- storage/                Shared storage root (models, uploads)
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.12 | Backend + ML notebooks |
| Node.js | >= 20 LTS | Frontend |
| npm | >= 10 | Package manager |
| Java JDK | 17 | Android build |
| Android Studio | Latest | Android SDK, emulator |
| Tesseract | 5.x | OCR binary (see Tesseract OCR Setup) |
| Git | Any | Version control |

> Supabase is optional -- only needed when `MOCK_AUTH_ENABLED=false`.

---

## Setup

Follow these steps in order. The backend requires trained model files before it can categorise transactions.

### 1. ML Models

```bash
cd ml

# Windows
py -3.12 -m venv .venv && .venv\Scripts\Activate.ps1
# macOS/Linux
python3.12 -m venv .venv && source .venv/bin/activate

pip install -r requirements.txt
jupyter lab
```

Open and run the notebooks **in order**:
1. `01_categorisation_model.ipynb` -- TF-IDF + Logistic Regression category classifier
2. `02_prediction_model.ipynb` -- XGBoost income and expense forecast models

Both notebooks save `.joblib` model files directly to `backend_api/storage/models/`.

### 2. Backend

```bash
cd backend_api

# Windows
py -3.12 -m venv .venv && .venv\Scripts\Activate.ps1
# macOS/Linux
python3.12 -m venv .venv && source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env    # Windows; use cp on macOS/Linux -- then edit (see Configuration)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

- API: **http://127.0.0.1:8000**
- Swagger UI: **http://127.0.0.1:8000/docs**
- SQLite database is created automatically at `storage/smartspend.db` on first startup.

**Verify the server is running:**
```bash
curl http://127.0.0.1:8000/health
# {"status":"ok","environment":"development","mock_auth_enabled":true}
```

**Test SMS parsing** (mock auth -- no token needed):
```bash
curl -X POST http://127.0.0.1:8000/transactions/sms/sync \
  -H "Content-Type: application/json" \
  -d "{\"consent_confirmed\": true, \"raw_sms_messages\": [\"MoMo: RWF 3500 paid to Bourbon Coffee Kigali. Transaction MM100141. Remaining balance RWF 224500.\"]}"
```

### 3. Frontend

```bash
cd frontend
npm install
echo "EXPO_PUBLIC_API_URL=http://10.0.2.2:8000" > .env   # Android emulator
npx expo start
```

| Target | How |
|---|---|
| Android emulator | Press `a` in the Expo CLI |
| Physical device (Expo Go) | Scan the QR code |
| Dev build with SMS support | `npx expo run:android` |

> **SMS reading** requires a dev build (`npx expo run:android`) -- not available in Expo Go. The import screen falls back to manual JSON input when running in Expo Go.

---

## Configuration

### Backend -- `backend_api/.env`

```env
# Auth
MOCK_AUTH_ENABLED=true          # true = skip JWT, use MOCK_USER_ID
MOCK_USER_ID=demo_user_001
SUPABASE_JWT_SECRET=            # required when MOCK_AUTH_ENABLED=false
SUPABASE_URL=                   # required when MOCK_AUTH_ENABLED=false
SUPABASE_ANON_KEY=              # required when MOCK_AUTH_ENABLED=false

# App
APP_ENV=development
SECRET_KEY=change-me-in-production

# Storage
STORAGE_ROOT=../storage
DATABASE_PATH=../storage/smartspend.db

# OCR
TESSERACT_OCR_ENABLED=true      # false = return mock OCR text
TESSERACT_LANG=eng
# TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe  # Windows only

# Receipt matching
RECEIPT_MATCH_AMOUNT_TOLERANCE=0.10
RECEIPT_MATCH_TIME_WINDOW_SECONDS=7200
RECEIPT_MATCH_MIN_CONFIDENCE=0.65

# ML retraining
MIN_CORRECTIONS_FOR_RETRAINING=5

# CORS
CORS_ORIGINS=["http://localhost:8081","http://127.0.0.1:8081"]
```

### Frontend -- `frontend/.env`

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:8000    # Android emulator (maps to host localhost)
# EXPO_PUBLIC_API_URL=http://192.168.x.x:8000  # physical device -- use your LAN IP
# EXPO_PUBLIC_API_URL=https://your-server       # production
```

> All frontend env vars must be prefixed with `EXPO_PUBLIC_` to be accessible in client code.

---

## Tesseract OCR Setup

Tesseract runs entirely on the server -- no API key or internet connection required after installation.

**Install the binary:**

| Platform | Command |
|---|---|
| Windows | Download installer from [UB-Mannheim releases](https://github.com/UB-Mannheim/tesseract/wiki) (v5.x recommended) |
| Linux (Debian/Ubuntu) | `sudo apt-get install -y tesseract-ocr` |
| macOS | `brew install tesseract` |

**Install the Python wrapper** (inside the backend venv):

```bash
pip install pytesseract Pillow
```

**Windows only** -- if Tesseract is not on your system PATH, set its location in `.env`:
```env
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

Supported upload formats: JPEG, PNG, WebP, PDF. Images are resized to <= 4096 px automatically before processing.

---

## Supabase Setup

Only required when `MOCK_AUTH_ENABLED=false`.

1. Create a project at [supabase.com](https://supabase.com).
2. Under **Settings -> API**, copy the **JWT Secret**, **Project URL**, and **anon/public key**.
3. Add to `backend_api/.env`:
   ```env
   SUPABASE_JWT_SECRET=<jwt-secret>
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   ```
4. In the frontend, use the Supabase JS client to sign in and attach the `access_token` as a `Bearer` header on all API requests.

---

## Android Permissions

Add to `frontend/android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.READ_SMS" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

> **Privacy:** SMS permission is requested only when the user taps "Import SMS" and confirms a consent dialog. Messages containing OTP, PIN, or passcode keywords are detected client-side and never uploaded.

---

## How It Works

### SMS Import

1. User taps **Import SMS** -- app reads the Android inbox via `react-native-get-sms-android`, filtered to MoMo/Airtel senders.
2. A consent dialog lists messages to be uploaded; user must confirm.
3. App calls `POST /transactions/sms/sync`.
4. Server-side:
   - Messages with OTP/PIN/passcode keywords are excluded and returned as `sensitive_warnings`.
   - Remaining messages are parsed by regex for MTN MoMo and Airtel Money formats.
   - Transactions are deduplicated: `source_message_id` -> `transaction_reference` -> hash+time+amount.
   - New expenses are matched against any existing receipts; monthly aggregates are refreshed.
5. App shows a summary: imported / duplicates skipped / failed / sensitive warnings.

### Receipt Matching

1. User uploads a receipt image via `POST /receipts/upload`.
2. Server-side:
   - Magic-byte validation confirms JPEG/PNG/WebP/PDF format.
   - Tesseract extracts text; `parse_receipt_header()` extracts merchant, total (RWF), and timestamp; `parse_receipt_items()` extracts line items.
   - A matching SMS transaction is found using a weighted confidence score:
     - Amount similarity: **50%** (tolerance +-10%)
     - Time proximity: **35%** (window +-2 hours)
     - Merchant name similarity: **15%**
   - Matches above 0.65 confidence are linked automatically. Users can manually link/unlink via `POST /receipts/{id}/link`.

### Per-User Model Retraining

1. User corrects a category via the **Fix** button on a transaction -- stored in `category_corrections`.
2. After every `MIN_CORRECTIONS_FOR_RETRAINING` (default: 5) corrections, a background retraining job is queued.
3. Retraining merges three data sources by weight:
   - Seed synthetic dataset: 1.0
   - Enriched receipt/prompt data: 1.5--2.5
   - User corrections: 3.0
4. Personalised model saved to `storage/models/users/{user_id}/expense_category.joblib`.
5. All subsequent predictions for that user use the personalised model.

Query `GET /models/versions` to see the active model version for a user.

---

## App Features

### Dashboard

| Feature | Description |
|---|---|
| Risk badge | Low / Watch out / High based on expense-to-income ratio (< 60% / 60-85% / > 85%) |
| Income & expense cards | Current month totals from parsed SMS transactions |
| Net balance | Income - expenses with a plain-language status message |
| ML forecast | XGBoost month-end income and expense predictions (shown when model is available) |
| Top category | Highest-spend category with amount and percentage |
| Spending trend | Line chart -- income vs expense for the last 4 months |
| Recent activity | Last 5 transactions inline |

### Analytics

- Category breakdown bar chart with item-level amounts and percentages
- Monthly expense bar chart with 1 / 3 / 6 / 12 month selector
- Monthly comparison table (income, expense, net per month)

### CSV Export

1. Go to the **Export** tab.
2. Select a date range and filter by type (All / Income / Expense).
3. Tap **Export to CSV** -- file is shared via the Android share sheet.

**Columns:** `date, type, amount_rwf, fee_rwf, to_who, from_who, reference, provider, balance_after_rwf, currency, parse_confidence`

### Category Correction

Tap **Fix** on any expense transaction to open a category picker. Saving the correction calls `POST /transactions/corrections` and may trigger background model retraining.

---

## Deployment

| Component | Platform | Config files |
|---|---|---|
| Backend | [Railway](https://railway.app) | `railway.json`, `Procfile`, `runtime.txt` |
| Android app | EAS Build | `eas.json`, `app.json` |
| Database | PostgreSQL (Supabase) | `DATABASE_URL` env var |

Set `MOCK_AUTH_ENABLED=false` and configure all three Supabase variables in the production environment. See [backend_api/README.md](backend_api/README.md) for the full endpoint reference and Railway-specific configuration notes.

---

## Troubleshooting

### Backend won't start

- **Missing `.env`**: `copy backend_api\.env.example backend_api\.env`
- **Wrong directory**: always run `uvicorn` from inside `backend_api/`

### `ModuleNotFoundError` on startup

```bash
backend_api\.venv\Scripts\Activate.ps1   # activate venv first
pip install -r requirements.txt
```

### Tesseract not found (Windows)

Add to `.env` (or add Tesseract to the system PATH and restart the terminal):
```env
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

### Android emulator can't reach the backend

- Set `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000` (not `localhost`).
- Check Windows Firewall is not blocking port 8000.

### SMS reading returns no messages

- Requires a dev build (`npx expo run:android`), not Expo Go.
- Grant SMS permission when prompted on the device.

### TypeScript errors after pull

```bash
cd frontend && npm install && npx expo start --clear
```

### Database schema is out of date

Delete `storage/smartspend.db` and restart the backend -- all tables are recreated automatically.
Warning: this deletes all local data.

### ML model not found

Run both ML notebooks -- they save model files directly to `backend_api/storage/models/`. If the categorisation endpoint returns 503, no model file is present in that directory.
