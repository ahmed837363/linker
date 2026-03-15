'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import api from '@/lib/api';

export function useAuth({ requireAuth = true }: { requireAuth?: boolean } = {}) {
  const router = useRouter();
  const { user, tenant, tokens, isLoading, setLoading, setUser, logout } = useAuthStore();

  useEffect(() => {
    async function checkAuth() {
      if (user && tenant) {
        setLoading(false);
        return;
      }

      if (!tokens?.accessToken) {
        setLoading(false);
        if (requireAuth) {
          router.push('/login');
        }
        return;
      }

      try {
        const data = await api.tenants.me();
        setUser(data.user, data.tenant);
      } catch {
        logout();
        if (requireAuth) {
          router.push('/login');
        }
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [user, tenant, tokens, requireAuth, router, setLoading, setUser, logout]);

  return { user, tenant, tokens, isLoading, isAuthenticated: !!user };
}
