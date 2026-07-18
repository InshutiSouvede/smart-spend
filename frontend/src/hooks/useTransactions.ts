import { useInfiniteQuery, useMutation, useQueryClient, InfiniteData } from '@tanstack/react-query';
import { transactionsApi, TransactionListParams } from '../api/transactions';
import type { CategoryCorrectionRequest, SMSIngestRequest, PaginatedResponse, SMSTransactionOut } from '../types/api';

const PAGE_SIZE = 20;

export function useTransactions(params: Omit<TransactionListParams, 'page' | 'page_size'> = {}) {
  return useInfiniteQuery({
    queryKey: ['transactions', params],
    queryFn: ({ pageParam = 1 }) =>
      transactionsApi.list({ ...params, page: pageParam as number, page_size: PAGE_SIZE }),
    getNextPageParam: (last) => (last.has_next ? last.page + 1 : undefined),
    initialPageParam: 1,
  });
}

export function useSyncSMS() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SMSIngestRequest) => transactionsApi.sync(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useCategoryCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategoryCorrectionRequest) =>
      transactionsApi.correctCategory(payload),
    onMutate: async (payload) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: ['transactions'] });

      // Snapshot all transaction query caches for rollback
      const previousQueries = qc.getQueriesData<InfiniteData<PaginatedResponse<SMSTransactionOut>>>({
        queryKey: ['transactions'],
      });

      // Optimistically update every cached transaction page
      qc.setQueriesData<InfiniteData<PaginatedResponse<SMSTransactionOut>>>(
        { queryKey: ['transactions'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((tx) => ({
                ...tx,
                purchase_details: tx.purchase_details?.map((pd) =>
                  pd.id === payload.purchase_detail_id
                    ? { ...pd, final_category: payload.corrected_category }
                    : pd,
                ),
              })),
            })),
          };
        },
      );

      return { previousQueries };
    },
    onError: (_err, _payload, context) => {
      // Roll back optimistic update on failure
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          qc.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      // Refetch to ensure server state is in sync
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
