import { apiClient } from './client';
import type { CategoryListResponse } from '../types/api';

export const modelsApi = {
  categories: () =>
    apiClient
      .get<CategoryListResponse>('/models/categories')
      .then((r) => r.data.categories),
};
