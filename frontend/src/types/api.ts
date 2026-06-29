// ─── Auth ────────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
}

export interface RegisterResponse {
  user_id: string;
  email: string;
  display_name?: string | null;
  access_token?: string | null;
  auth_mode: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user_id: string;
  email: string;
  display_name?: string | null;
  access_token?: string | null;
  token_type: string;
  auth_mode: string;
}

export interface UserProfile {
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  auth_mode: string;
}

// ─── Transactions / SMS ───────────────────────────────────────────────────────

export interface SMSMessage {
  raw_sms_text: string;
  source_message_id?: string;
  sender?: string;
  sms_time?: string;
}

export interface SMSIngestRequest {
  consent_confirmed: boolean;
  messages: SMSMessage[];
}

export interface PurchaseDetailOut {
  id: number;
  merchant_name?: string | null;
  total_cost_rwf?: number | null;
  purchase_time?: string | null;
  category?: string | null;
  final_category?: string | null;
}

export interface SMSTransactionOut {
  id: number;
  transaction_type: string;
  amount_rwf: number;
  fee_rwf: number;
  balance_after_rwf?: number | null;
  to_who?: string | null;
  from_who?: string | null;
  transaction_time?: string | null;
  transaction_reference?: string | null;
  parse_confidence: number;
  provider?: string | null;
  currency: string;
  created_at?: string | null;
  purchase_details?: PurchaseDetailOut[] | null;
  match_status?: string | null;
  clarification_prompt?: string | null;
}

export interface SMSSyncFailedItem {
  index: number;
  sender?: string | null;
  sms_time?: string | null;
  raw_sms_hash: string;
  reason: string;
}

export interface SMSSyncSensitiveWarning {
  index: number;
  sender?: string | null;
  sms_time?: string | null;
  sensitive_flags: string[];
  message: string;
}

export interface SMSSyncResponse {
  imported: SMSTransactionOut[];
  duplicates_skipped: number;
  failed: SMSSyncFailedItem[];
  sensitive_warnings: SMSSyncSensitiveWarning[];
  last_import_at?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

// ─── Receipts ─────────────────────────────────────────────────────────────────

export interface ReceiptUploadOut {
  id: number;
  filename: string;
  merchant_name?: string | null;
  total_amount_rwf?: number | null;
  receipt_timestamp?: string | null;
  matched_sms_id?: number | null;
  match_confidence?: number | null;
  match_status?: string | null;
  created_at?: string | null;
  purchase_details?: PurchaseDetailOut[];
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface CategorySummary {
  category: string;
  total_rwf: number;
  count: number;
  percentage: number;
}

export interface AnalyticsSummary {
  period_start: string;
  period_end: string;
  total_income_rwf: number;
  total_expense_rwf: number;
  transaction_count: number;
  net_rwf: number;
  categories: CategorySummary[];
}
