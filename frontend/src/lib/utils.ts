import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import type { Platform } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency: string = 'USD'
): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

export function formatDate(
  date: string | Date,
  formatStr: string = 'MMM d, yyyy'
): string {
  return format(new Date(date), formatStr);
}

export function formatRelativeDate(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function platformDisplayName(platform: Platform): string {
  const names: Record<Platform, string> = {
    shopify: 'Shopify',
    salla: 'Salla',
    woocommerce: 'WooCommerce',
    amazon: 'Amazon',
    noon: 'Noon',
    zid: 'Zid',
    tiktok_shop: 'TikTok Shop',
    ebay: 'eBay',
    etsy: 'Etsy',
    walmart: 'Walmart',
    mercado_libre: 'MercadoLibre',
    aliexpress: 'AliExpress',
    magento: 'Magento',
  };
  return names[platform] || platform;
}

export function platformColor(platform: Platform): string {
  const colors: Record<Platform, string> = {
    shopify: '#96BF48',
    salla: '#004956',
    woocommerce: '#96588A',
    amazon: '#FF9900',
    noon: '#FEEE00',
    zid: '#4B39EF',
    tiktok_shop: '#00F2EA',
    ebay: '#E53238',
    etsy: '#F1641E',
    walmart: '#0071DC',
    mercado_libre: '#FFE600',
    aliexpress: '#E43225',
    magento: '#F26322',
  };
  return colors[platform] || '#6B7280';
}

export function platformBgClass(platform: Platform): string {
  const classes: Record<Platform, string> = {
    shopify: 'bg-green-500/20 text-green-400',
    salla: 'bg-teal-500/20 text-teal-400',
    woocommerce: 'bg-purple-500/20 text-purple-400',
    amazon: 'bg-orange-500/20 text-orange-400',
    noon: 'bg-yellow-500/20 text-yellow-400',
    zid: 'bg-indigo-500/20 text-indigo-400',
    tiktok_shop: 'bg-cyan-500/20 text-cyan-400',
    ebay: 'bg-red-500/20 text-red-400',
    etsy: 'bg-orange-600/20 text-orange-300',
    walmart: 'bg-blue-500/20 text-blue-400',
    mercado_libre: 'bg-yellow-600/20 text-yellow-300',
    aliexpress: 'bg-red-600/20 text-red-300',
    magento: 'bg-orange-500/20 text-orange-400',
  };
  return classes[platform] || 'bg-gray-500/20 text-gray-400';
}

export function statusColor(status: string): string {
  const colors: Record<string, string> = {
    active: 'bg-accent-600/20 text-accent-400',
    inactive: 'bg-gray-500/20 text-gray-400',
    error: 'bg-red-500/20 text-red-400',
    syncing: 'bg-blue-500/20 text-blue-400',
    draft: 'bg-yellow-500/20 text-yellow-400',
    archived: 'bg-gray-500/20 text-gray-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    confirmed: 'bg-blue-500/20 text-blue-400',
    processing: 'bg-indigo-500/20 text-indigo-400',
    shipped: 'bg-purple-500/20 text-purple-400',
    delivered: 'bg-accent-600/20 text-accent-400',
    cancelled: 'bg-red-500/20 text-red-400',
    refunded: 'bg-orange-500/20 text-orange-400',
    in_stock: 'bg-accent-600/20 text-accent-400',
    low_stock: 'bg-yellow-500/20 text-yellow-400',
    out_of_stock: 'bg-red-500/20 text-red-400',
  };
  return colors[status] || 'bg-gray-500/20 text-gray-400';
}

export function truncate(str: string, length: number = 50): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function percentageChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}
