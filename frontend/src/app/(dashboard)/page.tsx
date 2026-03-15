'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  ShoppingCart,
  Package,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '@/lib/api';
import { formatCurrency, formatDate, platformDisplayName, platformBgClass } from '@/lib/utils';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/loading';
import type {
  AnalyticsOverview,
  RevenueSeries,
  Order,
  PlatformConnection,
} from '@/types';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function DashboardPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [revenueSeries, setRevenueSeries] = useState<RevenueSeries[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [ov, rs, orders, conns] = await Promise.allSettled([
          api.analytics.overview('30d'),
          api.analytics.revenueSeries('30d', 'day'),
          api.orders.recent(),
          api.tenants.connections(),
        ]);

        if (ov.status === 'fulfilled') setOverview(ov.value);
        if (rs.status === 'fulfilled') setRevenueSeries(rs.value);
        if (orders.status === 'fulfilled') setRecentOrders(orders.value);
        if (conns.status === 'fulfilled') setConnections(conns.value);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-dashboard-muted mt-1">Welcome back. Here is your overview.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  const chartData = revenueSeries.map((item) => ({
    date: formatDate(item.date, 'MMM d'),
    revenue: item.total,
  }));

  const orderStatusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'default' | 'purple'> = {
      delivered: 'success',
      shipped: 'purple',
      processing: 'info',
      pending: 'warning',
      cancelled: 'danger',
      refunded: 'danger',
    };
    return map[status] || 'default';
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={item}>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-dashboard-muted mt-1">
          Welcome back. Here is your overview for the last 30 days.
        </p>
      </motion.div>

      {/* Stat Cards */}
      <motion.div
        variants={item}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Total Revenue"
          value={formatCurrency(overview?.totalRevenue || 0)}
          trend={overview?.revenueChange}
          trendLabel="vs prev. 30d"
        />
        <StatCard
          icon={<ShoppingCart className="w-5 h-5" />}
          label="Total Orders"
          value={String(overview?.totalOrders || 0)}
          trend={overview?.ordersChange}
          trendLabel="vs prev. 30d"
        />
        <StatCard
          icon={<Package className="w-5 h-5" />}
          label="Active Products"
          value={String(overview?.activeProducts || 0)}
          trend={overview?.productsChange}
          trendLabel="vs prev. 30d"
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Avg. Order Value"
          value={formatCurrency(overview?.averageOrderValue || 0)}
          trend={overview?.aovChange}
          trendLabel="vs prev. 30d"
        />
      </motion.div>

      {/* Revenue Chart */}
      <motion.div variants={item}>
        <Card>
          <CardHeader
            title="Revenue Overview"
            description="Daily revenue for the last 30 days"
          />
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                  formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#2563EB"
                  strokeWidth={2}
                  fill="url(#revenueGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <motion.div variants={item} className="lg:col-span-2">
          <Card noPadding>
            <div className="px-6 pt-6">
              <CardHeader
                title="Recent Orders"
                action={
                  <a
                    href="/orders"
                    className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors"
                  >
                    View all
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                }
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dashboard-border">
                    <th className="px-6 py-3 text-left text-xs font-medium text-dashboard-muted uppercase">
                      Order
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-dashboard-muted uppercase">
                      Platform
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-dashboard-muted uppercase">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-dashboard-muted uppercase">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-dashboard-muted uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashboard-border">
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-8 text-center text-dashboard-muted text-sm"
                      >
                        No recent orders
                      </td>
                    </tr>
                  ) : (
                    recentOrders.slice(0, 6).map((order) => (
                      <tr
                        key={order.id}
                        className="hover:bg-dashboard-hover/50 transition-colors"
                      >
                        <td className="px-6 py-3 text-sm font-medium text-white">
                          #{order.orderNumber}
                        </td>
                        <td className="px-6 py-3">
                          <Badge className={platformBgClass(order.platform)}>
                            {platformDisplayName(order.platform)}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 text-sm text-dashboard-text">
                          {order.customerName}
                        </td>
                        <td className="px-6 py-3 text-sm text-white font-medium">
                          {formatCurrency(order.total, order.currency)}
                        </td>
                        <td className="px-6 py-3">
                          <Badge variant={orderStatusVariant(order.status)} dot>
                            {order.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>

        {/* Platform Health */}
        <motion.div variants={item}>
          <Card>
            <CardHeader title="Platform Health" />
            <div className="space-y-3">
              {connections.length === 0 ? (
                <p className="text-sm text-dashboard-muted text-center py-6">
                  No platforms connected yet
                </p>
              ) : (
                connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-dashboard-dark/50 border border-dashboard-border"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">
                        {platformDisplayName(conn.platform)}
                      </p>
                      <p className="text-xs text-dashboard-muted">
                        {conn.productsCount} products &middot;{' '}
                        {conn.ordersCount} orders
                      </p>
                    </div>
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
                    >
                      {conn.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
