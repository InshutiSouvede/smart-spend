# SmartSpend — Mobile Frontend

React Native / Expo frontend for the SmartSpend personal finance tracker.

## Tech stack

| Concern | Library |
|---|---|
| Framework | React Native + Expo SDK 52 |
| Language | TypeScript (strict) |
| Navigation | React Navigation 6 (native stack + bottom tabs) |
| Server state | TanStack Query v5 |
| Client state | Zustand v5 |
| HTTP | Axios |
| Forms | React Hook Form + Zod |
| Secure storage | Expo Secure Store |
| Image pick/capture | Expo Image Picker + Expo Camera |
| Image resize | expo-image-manipulator |
| Charts | react-native-chart-kit + react-native-svg |
| SMS reading | react-native-get-sms-android *(dev build only)* |

---

## Setup

```bash
cd frontend
npm install

# Set API URL
echo "EXPO_PUBLIC_API_URL=http://10.0.2.2:8000" > .env

# Start Expo development server
npx expo start
```

- **Android emulator:** use `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000`
- **Physical device (same LAN):** use your machine's LAN IP, e.g. `http://192.168.1.42:8000`
- **iOS simulator:** use `http://127.0.0.1:8000`

---

## Screens

| Tab | Screen | Description |
|-----|--------|-------------|
| Dashboard | `HomeScreen` | Risk badge, income/expense cards, net balance, ML forecast, spending rate progress bar, trend chart, unmatched alert, recent 5 transactions, quick actions |
| Analytics | `AnalyticsScreen` | Category breakdown bar chart + list, monthly expense chart (1/3/6/12 month), monthly comparison table, export link |
| Transactions | `TransactionsScreen` | Paginated list, income/expense filter, category correction (Fix button + picker modal) |
| Receipts | `ReceiptsScreen` | Paginated receipt list with match status |
| Export | `ExportScreen` | Date range + type filter, CSV export via system share sheet |
| Profile | `ProfileScreen` | Edit display name, sign out |

Auth screens: `LoginScreen`, `SignupScreen`

---

## Authentication

Tokens are stored with **Expo Secure Store** (Android Keystore / iOS Keychain). On app launch, `restoreAuth()` reads the stored token and user. On 401, the Axios interceptor clears stored credentials and returns the user to login.

Auth mode is controlled by the backend's `MOCK_AUTH_ENABLED` setting:
- `true` (default): any request is accepted, assigned to `MOCK_USER_ID`
- `false`: validates Supabase Bearer JWT

---

## Category correction

Expense transactions that have linked purchase items show a **Fix** button. Tapping it opens the `CategoryPicker` bottom sheet. Selecting a category calls `POST /transactions/corrections`, which:

1. Updates `final_category` in the database.
2. Records a correction for ML retraining.
3. Auto-triggers background retraining every 5 corrections (configurable).

---

## CSV export

The Export tab calls `GET /transactions/export/csv` with auth headers via Axios and receives the CSV as a text response. The CSV is shared via the React Native `Share` API — the user can save it to Files, email it, or open it in a spreadsheet app.

Columns: `date, type, amount_rwf, fee_rwf, to_who, from_who, reference, provider, balance_after_rwf, currency, parse_confidence`

---

## SMS import — EAS Build recommended ✅

`react-native-get-sms-android` is a native module not available in Expo Go. **Use EAS Build for full SMS functionality.**

### Quick Start with EAS (Recommended)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build development APK (includes SMS support)
npm run eas:build:dev

# Or build locally (faster)
npm run eas:dev
```

📖 **See [EAS_BUILD_GUIDE.md](./EAS_BUILD_GUIDE.md) for complete setup instructions.**

### How it works

EAS Build automatically:
- ✅ Links `react-native-get-sms-android` native module
- ✅ Configures Android permissions (READ_SMS, RECEIVE_SMS)
- ✅ Creates development builds for testing
- ✅ Supports hot-reload with dev client
- ✅ No manual `expo prebuild` needed!

### Alternative: Manual build

```bash
npx expo run:android
```

---

## Project structure

```
src/
├── api/            Axios API wrappers
│   ├── analytics.ts    summary, spendingStatus, monthlyTrends, categoryBreakdown
│   ├── auth.ts
│   ├── client.ts       Axios instance + interceptors
│   ├── models.ts       categories list
│   ├── receipts.ts
│   └── transactions.ts list, sync, correctCategory, exportCsv
├── components/
│   ├── CategoryPicker.tsx   Bottom sheet for category selection
│   ├── ErrorBanner.tsx
│   ├── LoadingOverlay.tsx
│   ├── ReceiptCard.tsx
│   └── TransactionCard.tsx  Shows category + confidence; Fix button for corrections
├── hooks/
│   ├── useAnalytics.ts     useAnalyticsSummary, useSpendingStatus, useMonthlyTrends, useCategoryBreakdown
│   ├── useModels.ts        useCategories
│   ├── useProfile.ts
│   ├── useReceipts.ts
│   └── useTransactions.ts  useTransactions, useSyncSMS, useCategoryCorrection
├── navigation/
│   ├── AppTabs.tsx     6-tab bottom navigator
│   ├── AuthStack.tsx
│   └── RootNavigator.tsx
├── screens/        (listed in Screens table above)
├── store/
│   └── authStore.ts    Zustand store with SecureStore persistence
├── types/
│   └── api.ts          All request/response TypeScript interfaces
└── theme.ts            Colors, spacing, radius, typography constants
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPO_PUBLIC_API_URL` | `http://127.0.0.1:8000` | Backend base URL |

---

## Verification steps

After starting both backend and frontend:

1. **Login/Register** — should succeed (mock auth auto-logs you in as `demo_user_001`).
2. **Dashboard** — should show 0 data cards and a "No data" risk badge initially.
3. **Import SMS** — import one or more SMS messages; dashboard should update on pull-to-refresh.
4. **Category correction** — tap Fix on an expense transaction with purchase details; select a category; confirm the alert shows "Category updated".
5. **Analytics** — open Analytics tab; category chart and monthly chart should render real data.
6. **Export** — open Export tab; tap Export to CSV; the share sheet should appear with CSV text.
7. **Upload receipt** — take or select a photo; the receipt list should show OCR results.
