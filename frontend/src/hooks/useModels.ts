import { useQuery } from '@tanstack/react-query';
import { modelsApi } from '../api/models';

export function useCategories() {
  return useQuery({
    queryKey: ['models', 'categories'],
    queryFn: modelsApi.categories,
    staleTime: Infinity,
  });
}
