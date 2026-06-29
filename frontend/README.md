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
| Charts | react-native-chart-kit |
| SMS reading | react-native-get-sms-android *(dev build only — see below)* |

---

## Setup

```bash
cd frontend
cp .env.example .env          # edit EXPO_PUBLIC_API_URL if needed
npm install
npx expo start
```

For a **physical device on the same LAN**, set `EXPO_PUBLIC_API_URL` to your
machine's LAN IP address (e.g. `http://192.168.1.42:8000`).

For an **Android emulator**, use `http://10.0.2.2:8000`.

---

## SMS Import — dev build required

Reading the device SMS inbox uses `react-native-get-sms-android`, which is a
native module **not available in the standard Expo Go app**.

In Expo Go, the SMS Import screen will display a notice explaining the
limitation. All other screens (auth, dashboard, receipts, profile) work
normally in Expo Go.

### Building a development client (Android)

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Log in and configure the project
eas login
eas build:configure          # creates eas.json if it doesn't exist

# 3. Build the development APK
eas build --profile development --platform android

# 4. Install the generated APK on your device and open it
```

Once running inside the dev client, the SMS Import screen will:
1. Request `READ_SMS` permission with a user-facing rationale.
2. Let the user choose a date range (defaulting to the last import timestamp).
3. Display SMS conversations grouped by sender.
4. Allow selecting individual messages or entire conversations.
5. Show a full preview of the selected messages.
6. Require an explicit consent toggle before the Upload button becomes active.
7. **Never upload messages automatically.**

### Google Play note

`READ_SMS` is a restricted permission on the Google Play Store. For public
distribution, document the use case in the Play Console Data Safety form. For
internal / enterprise distribution, no special approval is needed.

---

## Screens

| Screen | Path | Notes |
|---|---|---|
| Login | `src/screens/LoginScreen.tsx` | RHF + Zod validation |
| Sign up | `src/screens/SignupScreen.tsx` | Registers then logs in automatically |
| Dashboard | `src/screens/HomeScreen.tsx` | Month summary + category bar chart |
| Transactions | `src/screens/TransactionsScreen.tsx` | Paginated list with income/expense filter |
| SMS Import | `src/screens/SMSImportScreen.tsx` | Dev build only; full consent flow |
| Receipts | `src/screens/ReceiptsScreen.tsx` | Paginated list |
| Receipt Upload | `src/screens/ReceiptUploadScreen.tsx` | Camera or gallery; resize before upload |
| Profile | `src/screens/ProfileScreen.tsx` | Edit name; sign out |

---

## Authentication

Tokens are stored with **Expo Secure Store** (uses Android Keystore / iOS
Keychain under the hood). On app launch, `restoreAuth()` reads the stored token
and user before the navigation container renders, so the user goes directly to
the app if already logged in.

The Axios client attaches the token as a `Bearer` header on every request. On
a `401` response the stored credentials are cleared and the navigation
container switches back to the `AuthStack`.

---

## Personalised ML retraining design

Each user's SMS transactions, receipt data, and category corrections are stored
with their `user_id` in the backend SQLite database. The retraining service
(`backend_api/app/services/retraining_service.py`) follows this design:

| Concern | Implementation |
|---|---|
| **Isolated training data** | All training rows are filtered by `user_id` before model fitting |
| **Per-user model artifacts** | Saved to `storage/models/users/{user_id}/{model_type}.joblib` |
| **Base model fallback** | If no personal model exists, the shared base model under `storage/models/` is used |
| **Correction influence** | Category corrections are weighted 3× higher than synthetic base data during training |
| **No shared training** | Real user data is never mixed into the base/global model |
| **Model versioning** | Every retrain writes a row to the `model_versions` table; old versions are set `is_active = 0` |
| **Retraining trigger** | Auto-queued when a user's correction count reaches a multiple of `min_corrections_for_retraining` (default 5); can also be triggered manually |
| **Testing** | Call `POST /models/retrain` (admin) or correct 5 categories; check `GET /models/versions` for the new version |

The mobile frontend contributes to retraining indirectly:

1. The user imports MoMo SMS → transactions are parsed and stored.
2. The user uploads a receipt → OCR extracts merchant + items; linked to SMS.
3. If the predicted category is wrong, the user can correct it in the app
   (corrections endpoint `POST /transactions/{id}/correct`).
4. After every 5 corrections, the backend automatically retrains the user's
   personal category model in the background.

This ensures each user's predictions improve over time without affecting any
other user's model.

---

## Project structure

```
frontend/
├── App.tsx                  Root component (QueryClient + NavigationContainer)
├── index.ts                 Expo entry point
├── app.json                 Expo config (permissions, plugins)
├── package.json
├── tsconfig.json
└── src/
    ├── api/                 Axios-based API layer
    ├── components/          Shared UI components
    ├── hooks/               TanStack Query hooks
    ├── navigation/          React Navigation stacks & tabs
    ├── screens/             One file per screen
    ├── services/            Native service wrappers (SMS)
    ├── store/               Zustand stores
    ├── theme.ts             Colour palette, spacing, typography
    └── types/               Shared TypeScript types mirroring backend schemas
```
