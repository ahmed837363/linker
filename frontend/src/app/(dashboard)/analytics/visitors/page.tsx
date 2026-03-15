'use client';

import React, { useState } from 'react';
import {
  Eye,
  MousePointer,
  Search,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { formatNumber, platformDisplayName, platformColor, cn } from '@/lib/utils';
import type { Platform } from '@/types';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

const trafficData = Array.from({ length: 14 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (13 - i));
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    views: Math.floor(Math.random() * 3000) + 800,
    visitors: Math.floor(Math.random() * 1500) + 400,
  };
});

const platformTraffic: { platform: Platform; views: number; visitors: number; bounceRate: number; avgDuration: string }[] = [
  { platform: 'shopify', views: 12400, visitors: 8200, bounceRate: 32, avgDuration: '3m 24s' },
  { platform: 'amazon', views: 9800, visitors: 7100, bounceRate: 45, avgDuration: '2m 10s' },
  { platform: 'salla', views: 6200, visitors: 4800, bounceRate: 28, avgDuration: '4m 02s' },
  { platform: 'noon', views: 4500, visitors: 3200, bounceRate: 38, avgDuration: '2m 45s' },
  { platform: 'ebay', views: 3100, visitors: 2100, bounceRate: 41, avgDuration: '2m 18s' },
];

const topSearchTerms = [
  { term: 'wireless headphones', count: 842, conversion: 12.3 },
  { term: 'smart watch', count: 654, conversion: 8.7 },
  { term: 'leather wallet', count: 521, conversion: 15.2 },
  { term: 'bluetooth speaker', count: 483, conversion: 9.1 },
  { term: 'phone case', count: 412, conversion: 18.4 },
  { term: 'laptop stand', count: 389, conversion: 6.8 },
];

const topViewedProducts = [
  { name: 'Wireless Headphones Pro', views: 2840, addToCart: 342, conversion: 12.0 },
  { name: 'Smart Watch Ultra', views: 2210, addToCart: 198, conversion: 8.9 },
  { name: 'Premium Leather Wallet', views: 1890, addToCart: 287, conversion: 15.1 },
  { name: 'Fitness Tracker Band', views: 1650, addToCart: 156, conversion: 9.4 },
  { name: 'Bluetooth Speaker Mini', views: 1420, addToCart: 201, conversion: 14.1 },
];

const totalViews = platformTraffic.reduce((s, p) => s + p.views, 0);
const totalVisitors = platformTraffic.reduce((s, p) => s + p.visitors, 0);

export default function VisitorAnalyticsPage() {
  const [range, setRange] = useState('14d');

  return (
    <>
      <Breadcrumbs />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Visitor Analytics</h1>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="input-base text-sm py-1.5"
        >
          <option value="7d">Last 7 days</option>
          <option value="14d">Last 14 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Views', value: formatNumber(totalViews), change: 15.2, icon: Eye, color: 'text-blue-400' },
          { label: 'Unique Visitors', value: formatNumber(totalVisitors), change: 9.8, icon: Globe, color: 'text-green-400' },
          { label: 'Avg. Session', value: '2m 52s', change: 4.1, icon: Clock, color: 'text-purple-400' },
          { label: 'Avg. Bounce Rate', value: '36.8%', change: -3.2, icon: MousePointer, color: 'text-orange-400' },
        ].map((card) => (
          <div key={card.label} className="bg-dashboard-card border border-dashboard-border rounded-xl p-5">
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
              <span className={cn('text-xs font-medium', card.change > 0 ? 'text-green-400' : 'text-red-400')}>
                {Math.abs(card.change)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Traffic over time */}
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-white mb-4">Traffic Over Time</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trafficData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#E2E8F0' }} />
              <Area type="monotone" dataKey="views" stroke="#2563EB" fill="#2563EB" fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="visitors" stroke="#059669" fill="#059669" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Traffic by Platform */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Views by Store</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={platformTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="platform" tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={(v) => platformDisplayName(v)} />
                <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#E2E8F0' }} />
                <Bar dataKey="views" radius={[4, 4, 0, 0]}>
                  {platformTraffic.map((entry) => (
                    <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Platform Detail Table */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-dashboard-border">
            <h3 className="text-sm font-semibold text-white">Store Breakdown</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dashboard-border text-dashboard-muted text-left">
                <th className="px-4 py-2.5 font-medium">Store</th>
                <th className="px-4 py-2.5 font-medium text-right">Views</th>
                <th className="px-4 py-2.5 font-medium text-right">Bounce</th>
                <th className="px-4 py-2.5 font-medium text-right">Avg Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashboard-border">
              {platformTraffic.map((p) => (
                <tr key={p.platform} className="hover:bg-dashboard-hover/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <span style={{ color: platformColor(p.platform) }} className="font-medium">
                      {platformDisplayName(p.platform)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-white">{formatNumber(p.views)}</td>
                  <td className="px-4 py-2.5 text-right text-dashboard-text">{p.bounceRate}%</td>
                  <td className="px-4 py-2.5 text-right text-dashboard-text">{p.avgDuration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Search Terms */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-dashboard-border flex items-center gap-2">
            <Search className="w-4 h-4 text-dashboard-muted" />
            <h3 className="text-sm font-semibold text-white">Top Search Terms</h3>
          </div>
          <div className="divide-y divide-dashboard-border">
            {topSearchTerms.map((st) => (
              <div key={st.term} className="flex items-center justify-between px-6 py-3 hover:bg-dashboard-hover/50 transition-colors">
                <div>
                  <p className="text-sm text-white">{st.term}</p>
                  <p className="text-xs text-dashboard-muted">{formatNumber(st.count)} searches</p>
                </div>
                <span className="text-sm font-medium text-green-400">{st.conversion}% conv.</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Viewed Products */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-dashboard-border flex items-center gap-2">
            <Eye className="w-4 h-4 text-dashboard-muted" />
            <h3 className="text-sm font-semibold text-white">Most Viewed Products</h3>
          </div>
          <div className="divide-y divide-dashboard-border">
            {topViewedProducts.map((p) => (
              <div key={p.name} className="flex items-center justify-between px-6 py-3 hover:bg-dashboard-hover/50 transition-colors">
                <div>
                  <p className="text-sm text-white">{p.name}</p>
                  <p className="text-xs text-dashboard-muted">{formatNumber(p.views)} views &middot; {formatNumber(p.addToCart)} add to cart</p>
                </div>
                <span className="text-sm font-medium text-green-400">{p.conversion}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
