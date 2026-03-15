import { create } from 'zustand';
import type { User, Tenant, AuthTokens } from '@/types';
import api from '@/lib/api';

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  tokens: AuthTokens | null;
  isLoading: boolean;

  setUser: (user: User, tenant: Tenant) => void;
  setTokens: (tokens: AuthTokens) => void;
  setLoading: (loading: boolean) => void;

  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  tokens:
    typeof window !== 'undefined'
      ? {
          accessToken: localStorage.getItem('accessToken') || '',
          refreshToken: localStorage.getItem('refreshToken') || '',
          expiresIn: 0,
        }
      : null,
  isLoading: true,

  setUser: (user, tenant) => set({ user, tenant }),

  setTokens: (tokens) => {
    api.setTokens(tokens);
    set({ tokens });
  },

  setLoading: (isLoading) => set({ isLoading }),

  login: async (email, password) => {
    const result = await api.auth.login({ email, password });
    api.setTokens(result.tokens);
    set({
      user: result.user,
      tenant: result.tenant,
      tokens: result.tokens,
    });
  },

  logout: () => {
    api.clearTokens();
    set({ user: null, tenant: null, tokens: null });
  },
}));
