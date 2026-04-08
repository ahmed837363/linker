'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';

const DEMO_USER = {
  id: 'demo-user-001',
  email: 'demo@linkerpro.com',
  fullName: 'Ahmed Al-Demo',
  role: 'owner' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DEMO_TENANT = {
  id: 'demo-tenant-001',
  name: 'Demo Store',
  slug: 'demo-store',
  plan: 'pro' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DEMO_TOKENS = {
  accessToken: 'demo-access-token',
  refreshToken: 'demo-refresh-token',
  expiresIn: 999999,
};

export default function DemoPage() {
  const router = useRouter();
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    // Set demo user data into store
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', DEMO_TOKENS.accessToken);
      localStorage.setItem('refreshToken', DEMO_TOKENS.refreshToken);
      localStorage.setItem('demo_mode', 'true');
    }
    useAuthStore.setState({
      user: DEMO_USER,
      tenant: DEMO_TENANT,
      tokens: DEMO_TOKENS,
      isLoading: false,
    });

    // Redirect to dashboard
    router.replace('/');
  }, [router, setUser, setLoading]);

  return (
    <div className="min-h-screen bg-dashboard-dark flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Entering Demo Mode...</h1>
        <p className="text-sm text-dashboard-muted">Loading Linker Pro dashboard</p>
      </div>
    </div>
  );
}
