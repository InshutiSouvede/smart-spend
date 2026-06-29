import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => authApi.profile(),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const updateUser = useAuthStore((s) => s.updateUser);
  return useMutation({
    mutationFn: (displayName: string) => authApi.updateProfile(displayName),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      updateUser({ display_name: data.display_name });
    },
  });
}
