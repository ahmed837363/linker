'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  BarChart3,
  Users,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import api from '@/lib/api';
import { formatCurrency, formatDate, platformDisplayName, platformColor } from '@/lib/utils';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/loading';
import type {
  AnalyticsOverview,
  SalesByPlatform,
  TopProduct,
  RevenueSeries,
  DateRange,
} from '@/types';
import Image from 'next/image';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

const ranges: { value: DateRange; label: string }[] = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: '12m', label: '12 Months' },
];

const platforms = ['shopify', 'amazon', 'ebay', 'etsy', 'woocommerce', 'walmart'] as const;

export default function AnalyticsPage() {
  const [range, setRange] = useState<DateRange>('30d');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [byPlatform, setByPlatform] = useState<SalesByPlatform[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [revenueSeries, setRevenueSeries] = useState<RevenueSeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [ov, bp, tp, rs] = await Promise.allSettled([
          api.analytics.overview(range),
          api.analytics.byPlatform(range),
          api.analytics.topProducts(range),
          api.analytics.revenueSeries(range, range === '12m' ? 'month' : 'day'),
        ]);
        if (ov.status === 'fulfilled') setOverview(ov.value);
        if (bp.status === 'fulfilled') setByPlatform(bp.value);
        if (tp.status === 'fulfilled') setTopProducts(tp.value);
        if (rs.status === 'fulfilled') setRevenueSeries(rs.value);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [range]);

  const chartLineData = revenueSeries.map((item) => ({
    date: formatDate(item.date, range === '12m' ? 'MMM yyyy' : 'MMM d'),
    total: item.total,
    ...item.byPlatform,
  }));

  const platformBarData = byPlatform.map((p) => ({
    name: platformDisplayName(p.platform),
    revenue: p.revenue,
    orders: p.orders,
    fill: platformColor(p.platform),
  }));

  if (loading) return <PageLoader />;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-dashboard-muted mt-1">
            Performance metrics and insights
          </p>
        </div>
        <div className="flex items-center border border-dashboard-border rounded-lg overflow-hidden">
          {ranges.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                range === r.value
                  ? 'bg-primary-600 text-white'
                  : 'text-dashboard-muted hover:text-white hover:bg-dashboard-hover'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* KPI Cards */}
      <motion.div
        variants={item}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4"
      >
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Total Revenue"
          value={formatCurrency(overview?.totalRevenue || 0)}
          trend={overview?.revenueChange}
        />
        <StatCard
          icon={<ShoppingCart className="w-5 h-5" />}
          label="Total Orders"
          value={String(overview?.totalOrders || 0)}
          trend={overview?.ordersChange}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Conversion Rate"
          value={`${(overview?.conversionRate || 0).toFixed(1)}%`}
          trend={overview?.conversionChange}
        />
        <StatCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Avg. Order Value"
          value={formatCurrency(overview?.averageOrderValue || 0)}
          trend={overview?.aovChange}
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Active Products"
          value={String(overview?.activeProducts || 0)}
          trend={overview?.productsChange}
        />
      </motion.div>

      {/* Revenue Line Chart */}
      <motion.div variants={item}>
        <Card>
          <CardHeader
            title="Revenue by Platform"
            description="Revenue breakdown across connected platforms"
          />
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartLineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  stroke="#94A3B8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94A3B8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    color: '#E2E8F0',
                    fontSize: '0.875rem',
                  }}
                  formatter={(value: number, name: string) => [
                    formatCurrency(value),
                    name === 'total' ? 'Total' : platformDisplayName(name as any),
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === 'total' ? 'Total' : platformDisplayName(value as any)
                  }
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#E2E8F0"
                  strokeWidth={2}
                  dot={false}
                />
                {platforms.map((p) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={p}
                    stroke={platformColor(p)}
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 4"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Comparison Bar Chart */}
        <motion.div variants={item}>
          <Card>
            <CardHeader title="Platform Comparison" description="Revenue & orders by platform" />
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platformBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="name"
                    stroke="#94A3B8"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94A3B8"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: '0.75rem',
                      color: '#E2E8F0',
                      fontSize: '0.875rem',
                    }}
                    formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                  />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {platformBarData.map((entry, index) => (
                      <rect key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Top Products */}
        <motion.div variants={item}>
          <Card noPadding>
            <div className="px-6 pt-6">
              <CardHeader title="Top Products" description="Best sellers by revenue" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dashboard-border">
                    <th className="px-6 py-3 text-left text-xs font-medium text-dashboard-muted uppercase">
                      Product
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-dashboard-muted uppercase">
                      Revenue
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-dashboard-muted uppercase">
                      Orders
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-dashboard-muted uppercase">
                      Units
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashboard-border">
                  {topProducts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-dashboard-muted text-sm">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    topProducts.slice(0, 8).map((product, idx) => (
                      <tr
                        key={product.productId}
                        className="hover:bg-dashboard-hover/50 transition-colors"
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-dashboard-muted font-mono w-4">
                              {idx + 1}
                            </span>
                            <div className="w-8 h-8 rounded bg-dashboard-hover overflow-hidden shrink-0">
                              {product.imageUrl ? (
                                <Image
                                  src={product.imageUrl}
                                  alt={product.title}
                                  width={32}
                                  height={32}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-dashboard-hover" />
                              )}
                            </div>
                            <span className="text-sm text-white truncate max-w-[200px]">
                              {product.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right text-sm font-medium text-white">
                          {formatCurrency(product.totalRevenue)}
                        </td>
                        <td className="px-6 py-3 text-right text-sm text-dashboard-text">
                          {product.totalOrders}
                        </td>
                        <td className="px-6 py-3 text-right text-sm text-dashboard-text">
                          {product.totalUnits}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
