import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { receiptsApi } from '../api/receipts';

const PAGE_SIZE = 20;

export function useReceipts() {
  return useInfiniteQuery({
    queryKey: ['receipts'],
    queryFn: ({ pageParam = 1 }) =>
      receiptsApi.list({ page: pageParam as number, page_size: PAGE_SIZE }),
    getNextPageParam: (last) => (last.has_next ? last.page + 1 : undefined),
    initialPageParam: 1,
  });
}

export function useReceipt(receiptId: number) {
  return useQuery({
    queryKey: ['receipt', receiptId],
    queryFn: () => receiptsApi.getById(receiptId),
  });
}

export function useUploadReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, mimeType }: { uri: string; mimeType: string }) =>
      receiptsApi.upload(uri, mimeType),
    onSuccess: () => {
      // Reset infinite query to force fresh fetch from page 1
      qc.resetQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useLinkReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ receiptId, smsId }: { receiptId: number; smsId: number }) =>
      receiptsApi.link(receiptId, smsId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['receipt'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useUnlinkReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (receiptId: number) => receiptsApi.unlink(receiptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['receipt'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useDeleteReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (receiptId: number) => receiptsApi.delete(receiptId),
    onSuccess: () => {
      qc.resetQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
