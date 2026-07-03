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

export function useSpendingStatus() {
  return useQuery({
    queryKey: ['analytics', 'spending-status'],
    queryFn: analyticsApi.spendingStatus,
    staleTime: 60_000,
  });
}

export function useMonthlyTrends(months = 6) {
  return useQuery({
    queryKey: ['analytics', 'monthly', months],
    queryFn: () => analyticsApi.monthlyTrends(months),
    staleTime: 5 * 60_000,
  });
}

export function useCategoryBreakdown(fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: ['analytics', 'categories', fromDate, toDate],
    queryFn: () => analyticsApi.categoryBreakdown({ from_date: fromDate, to_date: toDate }),
    staleTime: 5 * 60_000,
  });
}

export function useUnmatchedExpenses() {
  return useQuery({
    queryKey: ['analytics', 'unmatched-expenses'],
    queryFn: analyticsApi.unmatchedExpenses,
    staleTime: 30_000,
  });
}

export function useDailyTrends(days = 30) {
  return useQuery({
    queryKey: ['analytics', 'daily', days],
    queryFn: () => analyticsApi.dailyTrends(days),
    staleTime: 5 * 60_000,
  });
}
