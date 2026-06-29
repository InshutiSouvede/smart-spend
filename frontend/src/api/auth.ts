import { apiClient } from './client';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UserProfile,
} from '../types/api';

export const authApi = {
  register: (payload: RegisterRequest) =>
    apiClient.post<RegisterResponse>('/auth/register', payload).then((r) => r.data),

  login: (payload: LoginRequest) =>
    apiClient.post<LoginResponse>('/auth/login', payload).then((r) => r.data),

  logout: () => apiClient.post('/auth/logout').then((r) => r.data),

  me: () => apiClient.get<{ user_id: string; auth_mode: string }>('/auth/me').then((r) => r.data),

  profile: () => apiClient.get<UserProfile>('/auth/profile').then((r) => r.data),

  updateProfile: (display_name: string) =>
    apiClient.patch<UserProfile>('/auth/profile', { display_name }).then((r) => r.data),
};
