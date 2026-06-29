import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics';

export function useAnalyticsSummary(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: ['analytics', 'summary', periodStart, periodEnd],
    queryFn: () =>
      analyticsApi.summary({
        period_start: periodStart,
        period_end: periodEnd,
      }),
  });
}
