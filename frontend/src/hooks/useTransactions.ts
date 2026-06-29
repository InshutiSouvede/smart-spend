import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transactionsApi, TransactionListParams } from '../api/transactions';
import type { SMSIngestRequest } from '../types/api';

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
