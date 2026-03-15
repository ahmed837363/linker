'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  AlertTriangle,
  Minus,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import { cn, platformDisplayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader } from '@/components/ui/loading';
import { Modal } from '@/components/ui/modal';
import type { InventoryItem, InventoryAlert, PaginatedResponse } from '@/types';
import toast from 'react-hot-toast';

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Adjust modal
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjusting, setAdjusting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, alertsRes] = await Promise.allSettled([
        api.inventory.list({
          search: search || undefined,
          status: statusFilter || undefined,
          page,
          limit: 20,
        }),
        api.inventory.alerts(),
      ]);

      if (inv.status === 'fulfilled') {
        const result = inv.value as PaginatedResponse<InventoryItem>;
        setInventory(result.data);
        setTotalPages(result.totalPages);
      }
      if (alertsRes.status === 'fulfilled') {
        setAlerts(alertsRes.value);
      }
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAdjust() {
    if (!adjustItem || adjustDelta === 0) return;
    setAdjusting(true);
    try {
      await api.inventory.adjust(adjustItem.variantId, adjustDelta);
      toast.success('Stock adjusted successfully');
      setAdjustItem(null);
      setAdjustDelta(0);
      fetchData();
    } catch {
      toast.error('Failed to adjust stock');
    } finally {
      setAdjusting(false);
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
      in_stock: { variant: 'success', label: 'In Stock' },
      low_stock: { variant: 'warning', label: 'Low Stock' },
      out_of_stock: { variant: 'danger', label: 'Out of Stock' },
    };
    const s = map[status] || { variant: 'default' as const, label: status };
    return (
      <Badge variant={s.variant} dot>
        {s.label}
      </Badge>
    );
  };

  const columns: Column<InventoryItem>[] = [
    {
      key: 'sku',
      header: 'SKU',
      sortable: true,
      render: (i) => (
        <span className="text-sm font-mono text-dashboard-muted">{i.sku}</span>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      render: (i) => (
        <div>
          <p className="text-sm font-medium text-white">{i.productTitle}</p>
          {i.variantTitle && (
            <p className="text-xs text-dashboard-muted">{i.variantTitle}</p>
          )}
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Stock Qty',
      sortable: true,
      render: (i) => (
        <span
          className={cn(
            'text-sm font-bold',
            i.stockQuantity === 0
              ? 'text-red-400'
              : i.stockQuantity <= i.lowStockThreshold
              ? 'text-yellow-400'
              : 'text-white'
          )}
        >
          {i.stockQuantity}
        </span>
      ),
    },
    {
      key: 'threshold',
      header: 'Threshold',
      render: (i) => (
        <span className="text-sm text-dashboard-muted">
          {i.lowStockThreshold}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (i) => statusBadge(i.status),
    },
    {
      key: 'sync',
      header: 'Platform Sync',
      render: (i) => (
        <div className="flex items-center gap-2">
          {i.platformSync.map((ps) => (
            <div key={ps.platform} className="flex items-center gap-1" title={platformDisplayName(ps.platform)}>
              <span className="text-xs text-dashboard-muted">
                {platformDisplayName(ps.platform).slice(0, 3)}
              </span>
              {ps.synced ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-accent-400" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24',
      render: (i) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAdjustItem(i);
            setAdjustDelta(0);
          }}
        >
          Adjust
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Inventory</h1>
        <p className="text-dashboard-muted mt-1">
          Manage stock levels and track inventory across platforms
        </p>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-sm font-semibold text-yellow-400">
              Stock Alerts ({alerts.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {alerts.slice(0, 6).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between bg-dashboard-dark/50 rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm text-white">{alert.productTitle}</p>
                  <p className="text-xs text-dashboard-muted">SKU: {alert.sku}</p>
                </div>
                <Badge variant={alert.type === 'out_of_stock' ? 'danger' : 'warning'}>
                  {alert.stockQuantity} left
                </Badge>
              </div>
            ))}
          </div>
        </motion.div>
      )}

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
            placeholder="Search by SKU or product name..."
            className="input-base pl-10 py-1.5 text-sm"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="input-base w-auto py-1.5 text-sm pr-8"
        >
          <option value="">All Status</option>
          <option value="in_stock">In Stock</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
        </select>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          onClick={fetchData}
          className="ml-auto"
        >
          Refresh
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <PageLoader />
      ) : inventory.length === 0 ? (
        <EmptyState
          title="No inventory items"
          description="Inventory will appear here once you add products."
        />
      ) : (
        <Card noPadding>
          <DataTable
            columns={columns}
            data={inventory}
            keyExtractor={(i) => i.variantId}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </Card>
      )}

      {/* Adjust Stock Modal */}
      <Modal
        isOpen={!!adjustItem}
        onClose={() => {
          setAdjustItem(null);
          setAdjustDelta(0);
        }}
        title="Adjust Stock"
        description={adjustItem ? `${adjustItem.productTitle} (${adjustItem.sku})` : ''}
      >
        {adjustItem && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-dashboard-muted mb-2">Current Stock</p>
              <p className="text-3xl font-bold text-white">
                {adjustItem.stockQuantity}
              </p>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setAdjustDelta(adjustDelta - 1)}
                className="w-10 h-10 rounded-lg bg-dashboard-hover flex items-center justify-center text-white hover:bg-dashboard-border transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="text-center">
                <input
                  type="number"
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(parseInt(e.target.value) || 0)}
                  className="w-20 text-center input-base text-lg font-bold"
                />
                <p className="text-xs text-dashboard-muted mt-1">
                  New total: {adjustItem.stockQuantity + adjustDelta}
                </p>
              </div>
              <button
                onClick={() => setAdjustDelta(adjustDelta + 1)}
                className="w-10 h-10 rounded-lg bg-dashboard-hover flex items-center justify-center text-white hover:bg-dashboard-border transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setAdjustItem(null);
                  setAdjustDelta(0);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleAdjust}
                isLoading={adjusting}
                disabled={adjustDelta === 0}
              >
                {adjustDelta >= 0 ? 'Add Stock' : 'Remove Stock'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
