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
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
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
