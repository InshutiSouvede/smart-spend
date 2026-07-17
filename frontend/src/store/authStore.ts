import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { TOKEN_KEY, USER_KEY, LAST_SMS_IMPORT_KEY } from '../api/client';

export interface AuthUser {
  user_id: string;
  email: string;
  display_name?: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  lastSmsImportAt: string | null;
  setAuth: (token: string, user: AuthUser) => Promise<void>;
  clearAuth: () => Promise<void>;
  restoreAuth: () => Promise<void>;
  setLastSmsImportAt: (ts: string) => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,
  lastSmsImportAt: null,

  setAuth: async (token, user) => {
    try {
      console.log('[AUTH_STORE] setAuth called');
      console.log('[AUTH_STORE] Token length:', token.length);
      console.log('[AUTH_STORE] Token preview:', token.substring(0, 30) + '...');
      console.log('[AUTH_STORE] User:', user.email);
      
      console.log('[AUTH_STORE] Saving token to SecureStore with key:', TOKEN_KEY);
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      console.log('[AUTH_STORE] ✓ Token saved');
      
      console.log('[AUTH_STORE] Saving user to SecureStore with key:', USER_KEY);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
      console.log('[AUTH_STORE] ✓ User saved');
      
      // Verify the token was actually saved
      const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      if (savedToken === token) {
        console.log('[AUTH_STORE] ✓ Token verification successful - read back matches');
      } else {
        console.error('[AUTH_STORE] ❌ Token verification failed!');
        console.error('[AUTH_STORE] ❌ Saved:', token.substring(0, 30));
        console.error('[AUTH_STORE] ❌ Read back:', savedToken?.substring(0, 30));
      }
      
      set({ token, user, isAuthenticated: true });
      console.log('[AUTH_STORE] ✓ State updated - user is now authenticated');
    } catch (error) {
      console.error('[AUTH_STORE] ❌ Error saving auth data:', error);
      throw error;
    }
  },

  clearAuth: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false, lastSmsImportAt: null });
  },

  restoreAuth: async () => {
    try {
      const [token, userStr, lastImport] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
        SecureStore.getItemAsync(LAST_SMS_IMPORT_KEY),
      ]);
      if (token && userStr) {
        const user = JSON.parse(userStr) as AuthUser;
        set({
          token,
          user,
          isAuthenticated: true,
          isLoading: false,
          lastSmsImportAt: lastImport ?? null,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  setLastSmsImportAt: async (ts) => {
    await SecureStore.setItemAsync(LAST_SMS_IMPORT_KEY, ts);
    set({ lastSmsImportAt: ts });
  },

  updateUser: (patch) => {
    const current = get().user;
    if (current) {
      const updated = { ...current, ...patch };
      set({ user: updated });
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated)).catch(() => {});
    }
  },
}));
