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
  source_type?: string;
  item_name?: string;
  normalized_item_name?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_cost_rwf?: number | null;
  total_cost_rwf?: number | null;
  merchant_name?: string | null;
  purchase_time?: string | null;
  predicted_category?: string | null;
  final_category?: string | null;
  category_confidence?: number | null;
  created_at?: string | null;
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

export interface ReceiptMatchOut {
  matched_sms_id?: number | null;
  match_confidence?: number | null;
  match_status: string;
}

export interface ReceiptUploadOut {
  receipt_id: number;
  ocr_status: string;
  extraction_status: string;
  ocr_mode?: string | null;
  merchant_name?: string | null;
  total_amount_rwf?: number | null;
  receipt_timestamp?: string | null;
  match?: ReceiptMatchOut | null;
  purchase_details: PurchaseDetailOut[];
  uploaded_at?: string | null;
}

export interface ReceiptSummary {
  receipt_id: number;
  ocr_status: string;
  extraction_status: string;
  merchant_name?: string | null;
  total_amount_rwf?: number | null;
  receipt_timestamp?: string | null;
  match_status: string;
  match_confidence?: number | null;
  matched_sms_id?: number | null;
  item_count: number;
  uploaded_at?: string | null;
}

export interface ReceiptLinkRequest {
  sms_transaction_id: number;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface CategorySummary {
  category: string;
  total_rwf: number;
  item_count: number;
  percentage: number;
}

export interface AnalyticsSummary {
  period_start: string;
  period_end: string;
  total_income: number;
  total_expense: number;
  net_balance: number;
  overspend: boolean;
  transaction_count: number;
  category_breakdown: CategorySummary[];
}

export interface MonthlySummary {
  period: string;
  total_income: number;
  total_expense: number;
  net: number;
  transaction_count: number;
}

export interface DailySummary {
  date: string;
  total_income: number;
  total_expense: number;
  net: number;
  transaction_count: number;
}

export interface SpendingStatusResponse {
  period: string;
  days_elapsed: number;
  days_remaining: number;
  total_income: number;
  total_expense: number;
  net_balance: number;
  expense_rate_pct: number;
  projected_month_end_expense: number;
  projected_net: number;
  top_category: string | null;
  top_category_amount: number;
  top_category_pct: number;
  risk_level: 'low' | 'medium' | 'high' | 'no_data';
  status_message: string;
  call_to_action: string;
  predicted_month_end_expense: number | null;
  predicted_month_end_income: number | null;
  unmatched_expense_count: number;
}

export interface CategoryCorrectionRequest {
  purchase_detail_id: number;
  corrected_category: string;
  trigger_retraining?: boolean;
}

export interface CategoryListResponse {
  categories: string[];
  custom_categories: string[];
}

export interface UnmatchedExpenseOut {
  sms_transaction_id: number;
  amount_rwf: number;
  to_who?: string | null;
  transaction_time?: string | null;
  clarification_prompt?: string | null;
}

export interface CustomCategoryCreate {
  name: string;
}

export interface CustomCategoryOut {
  id: number;
  name: string;
  created_at?: string | null;
}
