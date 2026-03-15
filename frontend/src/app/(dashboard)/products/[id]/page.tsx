'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  Edit3,
  Trash2,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Package,
  Store,
} from 'lucide-react';
import api from '@/lib/api';
import type { Product, PlatformListing } from '@/types';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import {
  formatCurrency,
  platformDisplayName,
  platformBgClass,
  cn,
} from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    api.products
      .get(productId)
      .then((p) => {
        setProduct(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [productId]);

  async function handlePushAll() {
    if (!product) return;
    setPushing(true);
    try {
      await api.products.pushAll(product.id);
    } catch {}
    setPushing(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-20 text-dashboard-muted">
        Product not found.
      </div>
    );
  }

  const images = product.images?.length ? product.images : [product.imageUrl].filter(Boolean) as string[];
  const totalStock = product.variants?.reduce((s, v) => s + v.stockQuantity, 0) ?? 0;
  const priceRange = product.variants?.length
    ? {
        min: Math.min(...product.variants.map((v) => v.price)),
        max: Math.max(...product.variants.map((v) => v.price)),
      }
    : null;

  return (
    <>
      <Breadcrumbs />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/products')}
            className="p-2 rounded-lg hover:bg-dashboard-hover text-dashboard-muted hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{product.title}</h1>
            <p className="text-sm text-dashboard-muted">
              {product.category || 'Uncategorized'} &middot;{' '}
              {product.variants?.length || 0} variant(s) &middot;{' '}
              {totalStock} in stock
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePushAll}
            disabled={pushing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            <RefreshCw className={cn('w-4 h-4', pushing && 'animate-spin')} />
            Push to All Stores
          </button>
          <button
            onClick={() => router.push(`/products/new?edit=${product.id}`)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dashboard-hover text-dashboard-text hover:text-white transition-colors text-sm"
          >
            <Edit3 className="w-4 h-4" />
            Edit
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Images */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
            {images.length > 0 ? (
              <div className="aspect-square bg-dashboard-dark flex items-center justify-center">
                <img
                  src={images[selectedImage]}
                  alt={product.title}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="aspect-square bg-dashboard-dark flex items-center justify-center">
                <Package className="w-16 h-16 text-dashboard-muted" />
              </div>
            )}
            {images.length > 1 && (
              <div className="flex gap-2 p-3 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={cn(
                      'w-14 h-14 rounded-lg border-2 shrink-0 overflow-hidden',
                      i === selectedImage
                        ? 'border-primary'
                        : 'border-dashboard-border'
                    )}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          {product.tags?.length > 0 && (
            <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {product.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded-full bg-dashboard-hover text-dashboard-text"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Price & Status */}
          <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-dashboard-muted">Price Range</p>
                <p className="text-2xl font-bold text-white">
                  {priceRange
                    ? priceRange.min === priceRange.max
                      ? formatCurrency(priceRange.min)
                      : `${formatCurrency(priceRange.min)} – ${formatCurrency(priceRange.max)}`
                    : '—'}
                </p>
              </div>
              <Badge
                variant={
                  product.status === 'active'
                    ? 'success'
                    : product.status === 'draft'
                    ? 'warning'
                    : 'default'
                }
              >
                {product.status}
              </Badge>
            </div>
            {product.description && (
              <p className="text-sm text-dashboard-text leading-relaxed">
                {product.description}
              </p>
            )}
          </div>

          {/* Variants */}
          <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-dashboard-border">
              <h3 className="text-sm font-semibold text-white">
                Variants ({product.variants?.length || 0})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dashboard-border text-dashboard-muted text-left">
                    <th className="px-6 py-3 font-medium">SKU</th>
                    <th className="px-6 py-3 font-medium">Title</th>
                    <th className="px-6 py-3 font-medium text-right">Price</th>
                    <th className="px-6 py-3 font-medium text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashboard-border">
                  {product.variants?.map((v) => (
                    <tr key={v.id} className="hover:bg-dashboard-hover/50 transition-colors">
                      <td className="px-6 py-3 font-mono text-xs text-dashboard-text">
                        {v.sku}
                      </td>
                      <td className="px-6 py-3 text-dashboard-text">
                        {v.title || '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-white font-medium">
                        {formatCurrency(v.price, v.currency)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span
                          className={cn(
                            'font-medium',
                            v.stockQuantity <= 0
                              ? 'text-red-400'
                              : v.stockQuantity <= v.lowStockThreshold
                              ? 'text-yellow-400'
                              : 'text-green-400'
                          )}
                        >
                          {v.stockQuantity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Store Connections */}
          <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-dashboard-border">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Store className="w-4 h-4" />
                Store Listings ({product.listings?.length || 0})
              </h3>
            </div>
            {product.listings?.length > 0 ? (
              <div className="divide-y divide-dashboard-border">
                {product.listings.map((listing) => (
                  <div
                    key={listing.id}
                    className="flex items-center justify-between px-6 py-3 hover:bg-dashboard-hover/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          platformBgClass(listing.platform)
                        )}
                      >
                        {platformDisplayName(listing.platform)}
                      </span>
                      <span className="text-sm text-dashboard-muted">
                        ID: {listing.platformProductId}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          listing.status === 'active'
                            ? 'success'
                            : listing.status === 'error'
                            ? 'danger'
                            : 'warning'
                        }
                        dot
                      >
                        {listing.status}
                      </Badge>
                      {listing.url && (
                        <a
                          href={listing.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-6 py-8 text-center text-dashboard-muted text-sm">
                Not listed on any store yet. Click "Push to All Stores" to publish.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
