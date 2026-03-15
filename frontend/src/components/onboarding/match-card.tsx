'use client';

import React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Package, Tag } from 'lucide-react';
import { cn, formatCurrency, platformDisplayName, platformBgClass } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { OnboardingProduct } from '@/types';

interface MatchCardProps {
  product: OnboardingProduct;
  side: 'left' | 'right';
  isAnchor?: boolean;
}

export function MatchCard({ product, side, isAnchor = false }: MatchCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === 'left' ? -20 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'bg-dashboard-card border rounded-xl overflow-hidden flex flex-col',
        isAnchor ? 'border-primary-600/50' : 'border-dashboard-border',
        'hover:border-primary-600/30 transition-colors'
      )}
    >
      {/* Platform badge header */}
      <div className="px-4 py-2 border-b border-dashboard-border flex items-center justify-between">
        <Badge className={platformBgClass(product.platform)}>
          {platformDisplayName(product.platform)}
        </Badge>
        {isAnchor && (
          <span className="text-xs font-medium text-primary-400">
            Anchor Product
          </span>
        )}
        {!isAnchor && (
          <span className="text-xs font-medium text-accent-400">
            Candidate Match
          </span>
        )}
      </div>

      {/* Product Image */}
      <div className="aspect-square relative bg-dashboard-dark/50 overflow-hidden">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.title}
            fill
            className="object-contain p-2"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-16 h-16 text-dashboard-hover" />
          </div>
        )}
      </div>

      {/* Product Details */}
      <div className="p-4 flex-1 space-y-3">
        <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
          {product.title}
        </h3>

        {/* Price */}
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">
            {formatCurrency(product.price, product.currency)}
          </span>
        </div>

        {/* SKU & Stock */}
        <div className="flex items-center gap-4 text-xs text-dashboard-muted">
          {product.sku && (
            <div className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              <span className="font-mono">{product.sku}</span>
            </div>
          )}
          {product.stockQuantity !== undefined && (
            <span
              className={cn(
                product.stockQuantity === 0
                  ? 'text-red-400'
                  : product.stockQuantity < 10
                  ? 'text-yellow-400'
                  : 'text-dashboard-muted'
              )}
            >
              {product.stockQuantity} in stock
            </span>
          )}
        </div>

        {/* Attributes */}
        {Object.keys(product.attributes).length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-dashboard-border">
            {Object.entries(product.attributes)
              .slice(0, 5)
              .map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-dashboard-muted capitalize">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <span className="text-dashboard-text font-medium truncate max-w-[140px]">
                    {value}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Category */}
        {product.category && (
          <div className="pt-1">
            <Badge variant="outline">{product.category}</Badge>
          </div>
        )}
      </div>
    </motion.div>
  );
}
