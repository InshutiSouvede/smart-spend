import { apiClient } from './client';
import type { AnalyticsSummary, CategorySummary, MonthlySummary, SpendingStatusResponse } from '../types/api';

export const analyticsApi = {
  summary: (params: { period_start?: string; period_end?: string } = {}) =>
    apiClient
      .get<AnalyticsSummary>('/analytics/summary', { params })
      .then((r) => r.data),

  spendingStatus: () =>
    apiClient
      .get<SpendingStatusResponse>('/analytics/spending-status')
      .then((r) => r.data),

  monthlyTrends: (months = 6) =>
    apiClient
      .get<MonthlySummary[]>('/analytics/monthly', { params: { months } })
      .then((r) => r.data),

  categoryBreakdown: (params: { from_date?: string; to_date?: string } = {}) =>
    apiClient
      .get<CategorySummary[]>('/analytics/categories', { params })
      .then((r) => r.data),
};
