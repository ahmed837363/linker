'use client';

import React, { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  RotateCcw,
  Package,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import {
  formatCurrency,
  formatNumber,
  platformDisplayName,
  platformColor,
  cn,
} from '@/lib/utils';
import type { Platform } from '@/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';

const ALL_PLATFORMS: Platform[] = ['shopify', 'salla', 'amazon', 'noon', 'ebay', 'etsy', 'walmart', 'woocommerce', 'tiktok_shop', 'zid'];

// Mock data
const storeRevenue = ALL_PLATFORMS.slice(0, 5).map((p) => ({
  platform: p,
  name: platformDisplayName(p),
  revenue: Math.floor(Math.random() * 50000) + 5000,
  orders: Math.floor(Math.random() * 300) + 20,
  returns: Math.floor(Math.random() * 15),
  returnValue: Math.floor(Math.random() * 2000),
}));

const dailyRevenue = Array.from({ length: 30 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (29 - i));
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    revenue: Math.floor(Math.random() * 5000) + 1000,
    orders: Math.floor(Math.random() * 50) + 5,
  };
});

const topProducts = [
  { name: 'Wireless Headphones Pro', revenue: 12400, units: 186, store: 'shopify' as Platform },
  { name: 'Smart Watch Ultra', revenue: 9800, units: 98, store: 'amazon' as Platform },
  { name: 'Leather Wallet Premium', revenue: 7200, units: 240, store: 'noon' as Platform },
  { name: 'Fitness Tracker Band', revenue: 5600, units: 175, store: 'salla' as Platform },
  { name: 'Bluetooth Speaker Mini', revenue: 4100, units: 124, store: 'ebay' as Platform },
];

const totalRevenue = storeRevenue.reduce((s, r) => s + r.revenue, 0);
const totalOrders = storeRevenue.reduce((s, r) => s + r.orders, 0);
const totalReturns = storeRevenue.reduce((s, r) => s + r.returns, 0);
const totalReturnVal = storeRevenue.reduce((s, r) => s + r.returnValue, 0);

type ViewMode = 'combined' | 'per-store';

export default function SalesPage() {
  const [view, setView] = useState<ViewMode>('combined');
  const [range, setRange] = useState('30d');

  return (
    <>
      <Breadcrumbs />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Sales</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-dashboard-card border border-dashboard-border rounded-lg overflow-hidden">
            <button
              onClick={() => setView('combined')}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                view === 'combined'
                  ? 'bg-primary text-white'
                  : 'text-dashboard-muted hover:text-white'
              )}
            >
              Combined
            </button>
            <button
              onClick={() => setView('per-store')}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                view === 'per-store'
                  ? 'bg-primary text-white'
                  : 'text-dashboard-muted hover:text-white'
              )}
            >
              Per Store
            </button>
          </div>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="input-base text-sm py-1.5"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="12m">Last 12 months</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Revenue', value: formatCurrency(totalRevenue), change: 12.5, icon: DollarSign, color: 'text-green-400' },
          { label: 'Total Orders', value: formatNumber(totalOrders), change: 8.3, icon: ShoppingCart, color: 'text-blue-400' },
          { label: 'Returns', value: formatNumber(totalReturns), change: -2.1, icon: RotateCcw, color: 'text-orange-400' },
          { label: 'Return Value', value: formatCurrency(totalReturnVal), change: -5.4, icon: TrendingDown, color: 'text-red-400' },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-dashboard-card border border-dashboard-border rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-dashboard-muted">{card.label}</span>
              <card.icon className={cn('w-5 h-5', card.color)} />
            </div>
            <p className="text-2xl font-bold text-white">{card.value}</p>
            <div className="flex items-center gap-1 mt-1">
              {card.change > 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
              )}
              <span
                className={cn(
                  'text-xs font-medium',
                  card.change > 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                {Math.abs(card.change)}%
              </span>
              <span className="text-xs text-dashboard-muted">vs last period</span>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-white mb-4">Revenue Over Time</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#E2E8F0',
                }}
              />
              <Line type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Revenue by Store */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Revenue by Store</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={storeRevenue} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={100} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    color: '#E2E8F0',
                  }}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {storeRevenue.map((entry) => (
                    <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Orders Distribution */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Orders Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={storeRevenue}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  dataKey="orders"
                  nameKey="name"
                >
                  {storeRevenue.map((entry) => (
                    <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    color: '#E2E8F0',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: '#94A3B8' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Products Table */}
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-dashboard-border">
          <h3 className="text-sm font-semibold text-white">Top Selling Products</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dashboard-border text-dashboard-muted text-left">
              <th className="px-6 py-3 font-medium">#</th>
              <th className="px-6 py-3 font-medium">Product</th>
              <th className="px-6 py-3 font-medium">Store</th>
              <th className="px-6 py-3 font-medium text-right">Revenue</th>
              <th className="px-6 py-3 font-medium text-right">Units Sold</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dashboard-border">
            {topProducts.map((p, i) => (
              <tr key={i} className="hover:bg-dashboard-hover/50 transition-colors">
                <td className="px-6 py-3 text-dashboard-muted">{i + 1}</td>
                <td className="px-6 py-3 text-white font-medium">{p.name}</td>
                <td className="px-6 py-3">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium',
                      `bg-[${platformColor(p.store)}]/20 text-[${platformColor(p.store)}]`
                    )}
                    style={{ backgroundColor: platformColor(p.store) + '30', color: platformColor(p.store) }}
                  >
                    {platformDisplayName(p.store)}
                  </span>
                </td>
                <td className="px-6 py-3 text-right text-white">{formatCurrency(p.revenue)}</td>
                <td className="px-6 py-3 text-right text-dashboard-text">{p.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
