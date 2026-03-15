'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, platformDisplayName, platformBgClass } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  BarChart3,
  DollarSign,
  Settings,
  Link2,
  Layers,
  ChevronLeft,
  ChevronRight,
  Store,
  TrendingUp,
  Eye,
  Plug,
  Bot,
} from 'lucide-react';
import type { PlatformConnection } from '@/types';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface NavGroup {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: Package },
      { href: '/inventory', label: 'Inventory', icon: Warehouse },
      { href: '/pricing', label: 'Pricing', icon: DollarSign },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { href: '/orders', label: 'Orders', icon: ShoppingCart },
      { href: '/sales', label: 'Sales', icon: TrendingUp },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/analytics/visitors', label: 'Visitors', icon: Eye },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { href: '/stores', label: 'Stores', icon: Store },
      { href: '/onboarding/match', label: 'Product Matching', icon: Layers },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const [connections, setConnections] = useState<PlatformConnection[]>([]);

  useEffect(() => {
    api.tenants
      .connections()
      .then(setConnections)
      .catch(() => {});
  }, []);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 bottom-0 z-40 flex flex-col bg-dashboard-card border-r border-dashboard-border transition-all duration-300',
        sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-16 border-b border-dashboard-border shrink-0">
        <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
          <Link2 className="w-4 h-4 text-white" />
        </div>
        {!sidebarCollapsed && (
          <span className="text-lg font-bold text-white whitespace-nowrap">
            Linker Pro
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-3 space-y-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!sidebarCollapsed && (
              <p className="text-[10px] font-semibold text-dashboard-muted uppercase tracking-widest px-3 mb-1.5">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'sidebar-link',
                      active && 'sidebar-link-active',
                      sidebarCollapsed && 'justify-center px-0'
                    )}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Connected Platforms */}
      {!sidebarCollapsed && connections.length > 0 && (
        <div className="px-4 py-4 border-t border-dashboard-border">
          <p className="text-xs font-medium text-dashboard-muted uppercase tracking-wider mb-3">
            Connected Platforms
          </p>
          <div className="space-y-2">
            {connections.slice(0, 4).map((conn) => (
              <div
                key={conn.id}
                className="flex items-center justify-between"
              >
                <span className="text-sm text-dashboard-text truncate">
                  {platformDisplayName(conn.platform)}
                </span>
                <Badge
                  variant={
                    conn.status === 'active'
                      ? 'success'
                      : conn.status === 'error'
                      ? 'danger'
                      : conn.status === 'syncing'
                      ? 'info'
                      : 'default'
                  }
                  dot
                  className={platformBgClass(conn.platform)}
                >
                  {conn.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center h-10 border-t border-dashboard-border
                   text-dashboard-muted hover:text-dashboard-text transition-colors"
      >
        {sidebarCollapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>
    </aside>
  );
}
