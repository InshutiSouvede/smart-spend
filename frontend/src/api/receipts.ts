import { apiClient } from './client';
import type { PaginatedResponse, ReceiptUploadOut, ReceiptSummary, ReceiptLinkRequest } from '../types/api';

export const receiptsApi = {
  list: (params: { page?: number; page_size?: number } = {}) =>
    apiClient
      .get<PaginatedResponse<ReceiptSummary>>('/receipts/', { params })
      .then((r) => r.data),

  listUnmatched: (params: { page?: number; page_size?: number } = {}) =>
    apiClient
      .get<PaginatedResponse<ReceiptSummary>>('/receipts/unmatched', { params })
      .then((r) => r.data),

  getById: (receiptId: number): Promise<ReceiptUploadOut> =>
    apiClient
      .get<ReceiptUploadOut>(`/receipts/${receiptId}`)
      .then((r) => r.data),

  upload: async (fileUri: string, mimeType: string): Promise<ReceiptUploadOut> => {
    const filename = fileUri.split('/').pop() ?? 'receipt.jpg';
    const formData = new FormData();
    // React Native FormData accepts this shape for file uploads
    formData.append('file', { uri: fileUri, name: filename, type: mimeType } as unknown as Blob);
    formData.append('consent_confirmed', 'true');
    return apiClient
      .post<ReceiptUploadOut>('/receipts/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      })
      .then((r) => r.data);
  },

  link: (receiptId: number, smsTxId: number) =>
    apiClient
      .post(`/receipts/${receiptId}/link`, { sms_transaction_id: smsTxId })
      .then((r) => r.data),

  unlink: (receiptId: number) =>
    apiClient.delete(`/receipts/${receiptId}/link`).then((r) => r.data),

  delete: (receiptId: number) =>
    apiClient.delete(`/receipts/${receiptId}`).then((r) => r.data),
};
