import { apiClient } from './client';
import type { PaginatedResponse, ReceiptUploadOut } from '../types/api';

export const receiptsApi = {
  list: (params: { page?: number; page_size?: number } = {}) =>
    apiClient
      .get<PaginatedResponse<ReceiptUploadOut>>('/receipts/', { params })
      .then((r) => r.data),

  listUnmatched: (params: { page?: number; page_size?: number } = {}) =>
    apiClient
      .get<PaginatedResponse<ReceiptUploadOut>>('/receipts/unmatched', { params })
      .then((r) => r.data),

  upload: async (fileUri: string, mimeType: string): Promise<ReceiptUploadOut> => {
    const filename = fileUri.split('/').pop() ?? 'receipt.jpg';
    const formData = new FormData();
    // React Native FormData accepts this shape for file uploads
    formData.append('file', { uri: fileUri, name: filename, type: mimeType } as unknown as Blob);
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
};
