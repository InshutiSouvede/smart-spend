import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

export const TOKEN_KEY = 'ss_token';
export const USER_KEY = 'ss_user';
export const LAST_SMS_IMPORT_KEY = 'ss_last_sms_import';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

console.log('[API Client] Base URL:', BASE_URL);

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the stored token before every request
apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const method = config.method?.toUpperCase() || 'REQUEST';
    const url = config.url || 'unknown';
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log(`[INTERCEPTOR] ${method} ${url}`);
      console.log(`[INTERCEPTOR] ✓ Token retrieved from SecureStore: ${token.substring(0, 30)}...`);
      console.log(`[INTERCEPTOR] ✓ Authorization header set: Bearer ${token.substring(0, 30)}...`);
    } else {
      console.warn(`[INTERCEPTOR] ⚠️ ${method} ${url}`);
      console.warn(`[INTERCEPTOR] ⚠️ No token found in SecureStore - Authorization header NOT added`);
      console.warn(`[INTERCEPTOR] ⚠️ This will cause 401 errors on protected endpoints`);
    }
  } catch (error) {
    console.error(`[INTERCEPTOR] ❌ Error retrieving token from SecureStore:`, error);
  }
  return config;
});

// On 401, clear stored credentials so the app returns to login
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      const detail = (error.response?.data as any)?.detail;
      console.error(`[INTERCEPTOR] 401 Unauthorized:`, detail);
      
      // Check if this is a token issue
      if (detail && typeof detail === 'string' && detail.includes('Missing or malformed')) {
        console.error(`[INTERCEPTOR] ❌ Token validation failed - likely SecureStore issue`);
        console.error(`[INTERCEPTOR] ❌ User will be logged out and redirected to login`);
      }
      
      // Clear stored credentials
      try {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
        console.log(`[INTERCEPTOR] Cleared stored credentials`);
      } catch (e) {
        console.error(`[INTERCEPTOR] Error clearing credentials:`, e);
      }
    }
    return Promise.reject(error);
  },
);

/** Extract a human-readable message from an Axios error or unknown throw. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as Record<string, unknown> | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return (detail as Array<{ msg?: string }>).map((d) => d.msg ?? String(d)).join(', ');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
