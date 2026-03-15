'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Plus,
  LayoutGrid,
  List,
  Filter,
  ExternalLink,
  MoreVertical,
  Package,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatCurrency, platformBgClass, platformDisplayName, statusColor, truncate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader } from '@/components/ui/loading';
import type { Product, PaginatedResponse } from '@/types';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [loading, setLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const result: PaginatedResponse<Product> = await api.products.list({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        limit: 12,
      });
      setProducts(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const columns: Column<Product>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (p) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-dashboard-hover overflow-hidden shrink-0">
            {p.imageUrl ? (
              <Image
                src={p.imageUrl}
                alt={p.title}
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-dashboard-muted text-xs">
                IMG
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{truncate(p.title, 40)}</p>
            <p className="text-xs text-dashboard-muted">
              {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (p) => (
        <Badge className={statusColor(p.status)} dot>
          {p.status}
        </Badge>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      render: (p) => (
        <span className="text-white font-medium">
          {p.variants[0]
            ? formatCurrency(p.variants[0].price, p.variants[0].currency)
            : '-'}
        </span>
      ),
    },
    {
      key: 'platforms',
      header: 'Platforms',
      render: (p) => (
        <div className="flex items-center gap-1 flex-wrap">
          {p.listings.map((l) => (
            <Badge key={l.id} className={platformBgClass(l.platform)}>
              {platformDisplayName(l.platform)}
            </Badge>
          ))}
          {p.listings.length === 0 && (
            <span className="text-xs text-dashboard-muted">Not listed</span>
          )}
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      sortable: true,
      render: (p) => {
        const totalStock = p.variants.reduce(
          (sum, v) => sum + v.stockQuantity,
          0
        );
        return (
          <span
            className={
              totalStock === 0
                ? 'text-red-400'
                : totalStock < 10
                ? 'text-yellow-400'
                : 'text-dashboard-text'
            }
          >
            {totalStock}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: () => (
        <button className="p-1 rounded hover:bg-dashboard-hover text-dashboard-muted hover:text-white transition-colors">
          <MoreVertical className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
          <p className="text-dashboard-muted mt-1">
            {total} product{total !== 1 ? 's' : ''} across all platforms
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => router.push('/products/new')}>Add Product</Button>
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
            placeholder="Search products..."
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
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>

        <div className="flex items-center border border-dashboard-border rounded-lg overflow-hidden ml-auto">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 transition-colors ${
              viewMode === 'grid'
                ? 'bg-primary-600 text-white'
                : 'text-dashboard-muted hover:text-white hover:bg-dashboard-hover'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 transition-colors ${
              viewMode === 'table'
                ? 'bg-primary-600 text-white'
                : 'text-dashboard-muted hover:text-white hover:bg-dashboard-hover'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <PageLoader />
      ) : products.length === 0 ? (
        <EmptyState
          title="No products found"
          description="Add your first product or connect a platform to import products automatically."
          actionLabel="Add Product"
          onAction={() => router.push('/products/new')}
        />
      ) : viewMode === 'grid' ? (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          {products.map((product) => {
            const totalStock = product.variants.reduce(
              (sum, v) => sum + v.stockQuantity,
              0
            );
            const price = product.variants[0]?.price;
            const currency = product.variants[0]?.currency || 'USD';

            return (
              <motion.div key={product.id} variants={item}>
                <Card className="group hover:border-primary-600/50 transition-all cursor-pointer overflow-hidden" noPadding onClick={() => router.push(`/products/${product.id}`)}>
                  {/* Image */}
                  <div className="aspect-square bg-dashboard-dark/50 relative overflow-hidden">
                    {product.imageUrl ? (
                      <Image
                        src={product.imageUrl}
                        alt={product.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-dashboard-muted">
                        <Package className="w-12 h-12" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Badge className={statusColor(product.status)} dot>
                        {product.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="text-sm font-medium text-white mb-1 line-clamp-2">
                      {product.title}
                    </h3>
                    <p className="text-lg font-bold text-white mb-2">
                      {price !== undefined ? formatCurrency(price, currency) : '-'}
                    </p>

                    {/* Platforms */}
                    <div className="flex items-center gap-1 mb-2 flex-wrap">
                      {product.listings.map((l) => (
                        <Badge
                          key={l.id}
                          className={platformBgClass(l.platform)}
                        >
                          {platformDisplayName(l.platform)}
                        </Badge>
                      ))}
                    </div>

                    {/* Stock */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-dashboard-muted">
                        {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
                      </span>
                      <span
                        className={
                          totalStock === 0
                            ? 'text-red-400'
                            : totalStock < 10
                            ? 'text-yellow-400'
                            : 'text-accent-400'
                        }
                      >
                        {totalStock} in stock
                      </span>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <Card noPadding>
          <DataTable
            columns={columns}
            data={products}
            keyExtractor={(p) => p.id}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </Card>
      )}

      {/* Pagination for grid view */}
      {viewMode === 'grid' && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-dashboard-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
