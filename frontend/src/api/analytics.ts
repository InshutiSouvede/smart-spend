import { apiClient } from './client';
import type { AnalyticsSummary } from '../types/api';

export const analyticsApi = {
  summary: (params: { period_start?: string; period_end?: string } = {}) =>
    apiClient
      .get<AnalyticsSummary>('/analytics/summary', { params })
      .then((r) => r.data),
};
