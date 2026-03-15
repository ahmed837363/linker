'use client';

import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/ui.store';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AiWidget } from '@/components/ai/ai-widget';
import { PageLoader } from '@/components/ui/loading';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useAuth({ requireAuth: true });
  const { sidebarCollapsed } = useUiStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dashboard-dark">
        <PageLoader />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-dashboard-dark">
      <Sidebar />
      <div
        className="transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? 72 : 260 }}
      >
        <Topbar />
        <main className="p-6">{children}</main>
      </div>
      <AiWidget />
    </div>
  );
}
