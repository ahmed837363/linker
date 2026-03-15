'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Calendar, Filter, Eye, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import {
  formatCurrency,
  formatDate,
  platformDisplayName,
  platformBgClass,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader } from '@/components/ui/loading';
import { Modal } from '@/components/ui/modal';
import type { Order, PaginatedResponse } from '@/types';

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const result: PaginatedResponse<Order> = await api.orders.list({
        search: search || undefined,
        platform: platformFilter || undefined,
        status: statusFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit: 20,
      });
      setOrders(result.data);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [search, platformFilter, statusFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const orderStatusVariant = (
    status: string
  ): 'success' | 'warning' | 'info' | 'danger' | 'default' | 'purple' => {
    const map: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'default' | 'purple'> = {
      delivered: 'success',
      shipped: 'purple',
      processing: 'info',
      confirmed: 'info',
      pending: 'warning',
      cancelled: 'danger',
      refunded: 'danger',
    };
    return map[status] || 'default';
  };

  const columns: Column<Order>[] = [
    {
      key: 'orderNumber',
      header: 'Order',
      sortable: true,
      render: (o) => (
        <span className="text-sm font-medium text-white">
          #{o.orderNumber}
        </span>
      ),
    },
    {
      key: 'platform',
      header: 'Platform',
      render: (o) => (
        <Badge className={platformBgClass(o.platform)}>
          {platformDisplayName(o.platform)}
        </Badge>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      render: (o) => (
        <div>
          <p className="text-sm text-white">{o.customerName}</p>
          <p className="text-xs text-dashboard-muted">{o.customerEmail}</p>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (o) => (
        <span className="text-sm text-dashboard-text">
          {o.items.length} item{o.items.length !== 1 ? 's' : ''}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      render: (o) => (
        <span className="text-sm font-medium text-white">
          {formatCurrency(o.total, o.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (o) => (
        <Badge variant={orderStatusVariant(o.status)} dot>
          {o.status}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (o) => (
        <span className="text-sm text-dashboard-muted">
          {formatDate(o.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (o) => (
        <button
          onClick={() => setSelectedOrder(o)}
          className="p-1 rounded hover:bg-dashboard-hover text-dashboard-muted hover:text-white transition-colors"
        >
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Orders</h1>
        <p className="text-dashboard-muted mt-1">
          {total} order{total !== 1 ? 's' : ''} across all platforms
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dashboard-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search orders..."
            className="input-base pl-10 py-1.5 text-sm"
          />
        </div>

        <select
          value={platformFilter}
          onChange={(e) => {
            setPlatformFilter(e.target.value);
            setPage(1);
          }}
          className="input-base w-auto py-1.5 text-sm pr-8"
        >
          <option value="">All Platforms</option>
          <option value="shopify">Shopify</option>
          <option value="amazon">Amazon</option>
          <option value="ebay">eBay</option>
          <option value="etsy">Etsy</option>
          <option value="woocommerce">WooCommerce</option>
          <option value="walmart">Walmart</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="input-base w-auto py-1.5 text-sm pr-8"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="input-base w-auto py-1.5 text-sm"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="input-base w-auto py-1.5 text-sm"
          placeholder="To"
        />
      </div>

      {/* Table */}
      {loading ? (
        <PageLoader />
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders found"
          description="Orders from connected platforms will appear here."
        />
      ) : (
        <Card noPadding>
          <DataTable
            columns={columns}
            data={orders}
            keyExtractor={(o) => o.id}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </Card>
      )}

      {/* Order Detail Modal */}
      <Modal
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder ? `Order #${selectedOrder.orderNumber}` : ''}
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-dashboard-muted uppercase mb-1">Platform</p>
                <Badge className={platformBgClass(selectedOrder.platform)}>
                  {platformDisplayName(selectedOrder.platform)}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-dashboard-muted uppercase mb-1">Status</p>
                <Badge variant={orderStatusVariant(selectedOrder.status)} dot>
                  {selectedOrder.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-dashboard-muted uppercase mb-1">Customer</p>
                <p className="text-sm text-white">{selectedOrder.customerName}</p>
                <p className="text-xs text-dashboard-muted">{selectedOrder.customerEmail}</p>
              </div>
              <div>
                <p className="text-xs text-dashboard-muted uppercase mb-1">Date</p>
                <p className="text-sm text-white">{formatDate(selectedOrder.createdAt, 'MMM d, yyyy HH:mm')}</p>
              </div>
            </div>

            <div className="border-t border-dashboard-border pt-4">
              <p className="text-sm font-medium text-white mb-3">Items</p>
              <div className="space-y-2">
                {selectedOrder.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between bg-dashboard-dark/50 rounded-lg p-3"
                  >
                    <div>
                      <p className="text-sm text-white">{item.title}</p>
                      <p className="text-xs text-dashboard-muted">
                        SKU: {item.sku} &middot; Qty: {item.quantity}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-white">
                      {formatCurrency(item.total, selectedOrder.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-dashboard-border pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-dashboard-muted">Subtotal</span>
                <span className="text-white">{formatCurrency(selectedOrder.subtotal, selectedOrder.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-dashboard-muted">Tax</span>
                <span className="text-white">{formatCurrency(selectedOrder.tax, selectedOrder.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-dashboard-muted">Shipping</span>
                <span className="text-white">{formatCurrency(selectedOrder.shipping, selectedOrder.currency)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-dashboard-border pt-2">
                <span className="text-white">Total</span>
                <span className="text-white">{formatCurrency(selectedOrder.total, selectedOrder.currency)}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
