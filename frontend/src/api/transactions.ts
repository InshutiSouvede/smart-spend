import { apiClient } from './client';
import type {
  CategoryCorrectionRequest,
  PaginatedResponse,
  SMSIngestRequest,
  SMSSyncResponse,
  SMSTransactionOut,
} from '../types/api';

export interface TransactionListParams {
  page?: number;
  page_size?: number;
  transaction_type?: 'income' | 'expense';
  from_date?: string;
  to_date?: string;
}

export const transactionsApi = {
  list: (params: TransactionListParams = {}) =>
    apiClient
      .get<PaginatedResponse<SMSTransactionOut>>('/transactions/', { params })
      .then((r) => r.data),

  listUnmatched: (params: { page?: number; page_size?: number } = {}) =>
    apiClient
      .get<PaginatedResponse<SMSTransactionOut>>('/transactions/unmatched', { params })
      .then((r) => r.data),

  sync: (payload: SMSIngestRequest) =>
    apiClient.post<SMSSyncResponse>('/transactions/sms/sync', payload).then((r) => r.data),

  correctCategory: (payload: CategoryCorrectionRequest) =>
    apiClient
      .post<{ job_id: string; status: string; message: string }>(
        '/transactions/corrections',
        payload,
      )
      .then((r) => r.data),

  exportCsv: (params: {
    from_date?: string;
    to_date?: string;
    transaction_type?: 'income' | 'expense';
  } = {}) =>
    apiClient
      .get<string>('/transactions/export/csv', {
        params,
        responseType: 'text',
      })
      .then((r) => r.data),

  submitItemDetails: (smsTransactionId: number, payload: {
    merchant_name?: string;
    items: Array<{
      item_name: string;
      quantity?: number;
      unit?: string;
      unit_cost_rwf?: number;
      total_cost_rwf: number;
      purchase_time?: string;
    }>;
  }) =>
    apiClient
      .post<{ message: string }>(`/transactions/${smsTransactionId}/prompt-response`, payload)
      .then((r) => r.data),
};
