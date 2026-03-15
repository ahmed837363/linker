'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Package, ShoppingCart, Store, BarChart3, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResult {
  type: 'product' | 'order' | 'store' | 'page';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const pages: SearchResult[] = [
  { type: 'page', id: 'dashboard', title: 'Dashboard', href: '/' },
  { type: 'page', id: 'products', title: 'Products', href: '/products' },
  { type: 'page', id: 'orders', title: 'Orders', href: '/orders' },
  { type: 'page', id: 'inventory', title: 'Inventory', href: '/inventory' },
  { type: 'page', id: 'analytics', title: 'Analytics', href: '/analytics' },
  { type: 'page', id: 'visitors', title: 'Visitor Analytics', href: '/analytics/visitors' },
  { type: 'page', id: 'sales', title: 'Sales', href: '/sales' },
  { type: 'page', id: 'pricing', title: 'Pricing', href: '/pricing' },
  { type: 'page', id: 'stores', title: 'Stores', href: '/stores' },
  { type: 'page', id: 'settings', title: 'Settings', href: '/settings' },
  { type: 'page', id: 'new-product', title: 'New Product', href: '/products/new' },
  { type: 'page', id: 'matching', title: 'Product Matching', href: '/onboarding/match' },
];

const iconMap: Record<SearchResult['type'], React.ElementType> = {
  product: Package,
  order: ShoppingCart,
  store: Store,
  page: BarChart3,
};

interface SearchResultsProps {
  query: string;
  onClose: () => void;
}

export function SearchResults({ query, onClose }: SearchResultsProps) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredPages = query.length > 0
    ? pages.filter(
        (p) =>
          p.title.toLowerCase().includes(query.toLowerCase()) ||
          p.href.toLowerCase().includes(query.toLowerCase())
      )
    : pages.slice(0, 6);

  const results: SearchResult[] = filteredPages;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  function handleSelect(result: SearchResult) {
    router.push(result.href);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (results.length === 0) {
    return (
      <div ref={ref} className="absolute left-0 top-full mt-1 w-full bg-dashboard-card border border-dashboard-border rounded-xl shadow-2xl p-4 z-50">
        <p className="text-sm text-dashboard-muted text-center">No results found</p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-full bg-dashboard-card border border-dashboard-border rounded-xl shadow-2xl overflow-hidden z-50"
      onKeyDown={handleKeyDown}
    >
      <div className="py-1 max-h-72 overflow-y-auto scrollbar-thin">
        {results.map((r, idx) => {
          const Icon = iconMap[r.type];
          return (
            <button
              key={r.id}
              onClick={() => handleSelect(r)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                idx === selectedIndex
                  ? 'bg-dashboard-hover text-white'
                  : 'text-dashboard-text hover:bg-dashboard-hover/50'
              )}
            >
              <Icon className="w-4 h-4 text-dashboard-muted shrink-0" />
              <div>
                <p className="text-sm">{r.title}</p>
                {r.subtitle && (
                  <p className="text-xs text-dashboard-muted">{r.subtitle}</p>
                )}
              </div>
              <span className="ml-auto text-[10px] text-dashboard-muted capitalize">{r.type}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
