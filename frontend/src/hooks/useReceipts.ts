import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useUploadReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, mimeType }: { uri: string; mimeType: string }) =>
      receiptsApi.upload(uri, mimeType),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
