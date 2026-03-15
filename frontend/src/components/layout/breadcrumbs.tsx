'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const routeLabels: Record<string, string> = {
  '': 'Dashboard',
  products: 'Products',
  new: 'New Product',
  inventory: 'Inventory',
  orders: 'Orders',
  analytics: 'Analytics',
  visitors: 'Visitors',
  pricing: 'Pricing',
  sales: 'Sales',
  stores: 'Stores',
  settings: 'Settings',
  onboarding: 'Onboarding',
  match: 'Product Matching',
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, idx) => {
    const href = '/' + segments.slice(0, idx + 1).join('/');
    const label = routeLabels[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
    const isLast = idx === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav className="flex items-center gap-1.5 text-sm text-dashboard-muted mb-4">
      <Link href="/" className="hover:text-white transition-colors">
        <Home className="w-3.5 h-3.5" />
      </Link>
      {crumbs.map((c) => (
        <React.Fragment key={c.href}>
          <ChevronRight className="w-3 h-3" />
          {c.isLast ? (
            <span className="text-dashboard-text font-medium">{c.label}</span>
          ) : (
            <Link href={c.href} className="hover:text-white transition-colors">
              {c.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
