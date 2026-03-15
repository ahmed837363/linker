'use client';

import React, { useState, useEffect } from 'react';
import {
  Store,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Unplug,
  Search,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import {
  platformDisplayName,
  platformColor,
  cn,
  formatNumber,
} from '@/lib/utils';
import type { Platform, PlatformConnection } from '@/types';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface PlatformInfo {
  key: Platform;
  name: string;
  description: string;
  region: string;
  authType: 'oauth' | 'api_key';
}

const allPlatforms: PlatformInfo[] = [
  { key: 'shopify', name: 'Shopify', description: 'Leading global e-commerce platform', region: 'Global', authType: 'oauth' },
  { key: 'salla', name: 'Salla', description: 'Saudi Arabia\'s top e-commerce platform', region: 'MENA', authType: 'oauth' },
  { key: 'amazon', name: 'Amazon', description: 'World\'s largest online marketplace', region: 'Global', authType: 'oauth' },
  { key: 'noon', name: 'Noon', description: 'Leading MENA marketplace', region: 'MENA', authType: 'api_key' },
  { key: 'woocommerce', name: 'WooCommerce', description: 'Open-source WordPress commerce', region: 'Global', authType: 'api_key' },
  { key: 'zid', name: 'Zid', description: 'Saudi e-commerce enabler', region: 'MENA', authType: 'oauth' },
  { key: 'tiktok_shop', name: 'TikTok Shop', description: 'Social commerce on TikTok', region: 'Global', authType: 'oauth' },
  { key: 'ebay', name: 'eBay', description: 'Global auction & shopping marketplace', region: 'Global', authType: 'oauth' },
  { key: 'etsy', name: 'Etsy', description: 'Handmade & vintage goods marketplace', region: 'Global', authType: 'oauth' },
  { key: 'walmart', name: 'Walmart', description: 'Walmart online marketplace', region: 'US', authType: 'api_key' },
  { key: 'mercado_libre', name: 'MercadoLibre', description: 'Latin America\'s largest marketplace', region: 'LATAM', authType: 'oauth' },
  { key: 'aliexpress', name: 'AliExpress', description: 'Global retail marketplace by Alibaba', region: 'Global', authType: 'api_key' },
  { key: 'magento', name: 'Magento', description: 'Adobe Commerce self-hosted platform', region: 'Global', authType: 'api_key' },
];

export default function StoresPage() {
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectModal, setConnectModal] = useState<PlatformInfo | null>(null);
  const [disconnectModal, setDisconnectModal] = useState<PlatformConnection | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storeUrlInput, setStoreUrlInput] = useState('');

  useEffect(() => {
    api.tenants
      .connections()
      .then((c) => {
        setConnections(c);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const connectedKeys = new Set(connections.map((c) => c.platform));

  const filtered = allPlatforms.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.region.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function getConnection(platform: Platform): PlatformConnection | undefined {
    return connections.find((c) => c.platform === platform);
  }

  function handleConnect(platform: PlatformInfo) {
    if (platform.authType === 'oauth') {
      // In production, redirect to OAuth flow
      window.open(`/api/v1/auth/${platform.key}/connect`, '_blank');
    } else {
      setConnectModal(platform);
    }
  }

  async function submitApiKey() {
    if (!connectModal) return;
    // In production, this would call the backend
    setConnectModal(null);
    setApiKeyInput('');
    setStoreUrlInput('');
  }

  async function handleDisconnect() {
    if (!disconnectModal) return;
    // In production, call backend disconnect
    setConnections(connections.filter((c) => c.id !== disconnectModal.id));
    setDisconnectModal(null);
  }

  return (
    <>
      <Breadcrumbs />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Stores</h1>
          <p className="text-sm text-dashboard-muted mt-1">
            {connections.length} connected &middot; {allPlatforms.length - connections.length} available
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dashboard-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search platforms..."
            className="input-base pl-10 py-1.5 text-sm w-56"
          />
        </div>
      </div>

      {/* Connected Stores */}
      {connections.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-dashboard-muted uppercase tracking-wider mb-3">
            Connected Stores
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connections.map((conn) => {
              const info = allPlatforms.find((p) => p.key === conn.platform);
              return (
                <div
                  key={conn.id}
                  className="bg-dashboard-card border border-dashboard-border rounded-xl p-5 hover:border-dashboard-hover transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: platformColor(conn.platform) + '30' }}
                      >
                        <Store className="w-5 h-5" style={{ color: platformColor(conn.platform) }} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {platformDisplayName(conn.platform)}
                        </h3>
                        <p className="text-xs text-dashboard-muted">{conn.storeName}</p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        conn.status === 'active' ? 'success' : conn.status === 'error' ? 'danger' : 'warning'
                      }
                      dot
                    >
                      {conn.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-dashboard-muted mb-4">
                    <span>{formatNumber(conn.productsCount)} products</span>
                    <span>{formatNumber(conn.ordersCount)} orders</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-dashboard-hover text-dashboard-text hover:text-white text-xs transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" /> Sync Now
                    </button>
                    <button
                      onClick={() => setDisconnectModal(conn)}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-400/10 text-xs transition-colors"
                    >
                      <Unplug className="w-3.5 h-3.5" /> Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Platforms */}
      <h2 className="text-sm font-semibold text-dashboard-muted uppercase tracking-wider mb-3">
        {connections.length > 0 ? 'Add More Stores' : 'Available Platforms'}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered
          .filter((p) => !connectedKeys.has(p.key))
          .map((platform) => (
            <div
              key={platform.key}
              className="bg-dashboard-card border border-dashboard-border rounded-xl p-5 hover:border-dashboard-hover transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: platformColor(platform.key) + '20' }}
                  >
                    <Store className="w-5 h-5" style={{ color: platformColor(platform.key) }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{platform.name}</h3>
                    <p className="text-xs text-dashboard-muted">{platform.region}</p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-dashboard-hover text-dashboard-muted uppercase">
                  {platform.authType === 'oauth' ? 'OAuth' : 'API Key'}
                </span>
              </div>
              <p className="text-xs text-dashboard-muted mb-4">{platform.description}</p>
              <button
                onClick={() => handleConnect(platform)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> Connect
              </button>
            </div>
          ))}
      </div>

      {/* API Key Connect Modal */}
      {connectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dashboard-card border border-dashboard-border rounded-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-white mb-1">
              Connect {connectModal.name}
            </h2>
            <p className="text-sm text-dashboard-muted mb-4">
              Enter your API credentials to connect your store.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-dashboard-muted mb-1">Store URL</label>
                <input
                  value={storeUrlInput}
                  onChange={(e) => setStoreUrlInput(e.target.value)}
                  className="w-full input-base"
                  placeholder="https://your-store.com"
                />
              </div>
              <div>
                <label className="block text-sm text-dashboard-muted mb-1">API Key / Secret</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-full input-base"
                  placeholder="Enter your API key"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={submitApiKey}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/80 font-medium text-sm transition-colors"
              >
                Connect
              </button>
              <button
                onClick={() => setConnectModal(null)}
                className="px-4 py-2 rounded-lg bg-dashboard-hover text-dashboard-text hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      {disconnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dashboard-card border border-dashboard-border rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Disconnect Store</h2>
                <p className="text-xs text-dashboard-muted">
                  {platformDisplayName(disconnectModal.platform)} &middot; {disconnectModal.storeName}
                </p>
              </div>
            </div>
            <p className="text-sm text-dashboard-text mb-6">
              This will stop syncing products, orders, and inventory. Your data will be preserved but no longer updated.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDisconnect}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium text-sm transition-colors"
              >
                Disconnect
              </button>
              <button
                onClick={() => setDisconnectModal(null)}
                className="px-4 py-2 rounded-lg bg-dashboard-hover text-dashboard-text hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
