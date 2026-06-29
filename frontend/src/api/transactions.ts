import { apiClient } from './client';
import type {
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
};
