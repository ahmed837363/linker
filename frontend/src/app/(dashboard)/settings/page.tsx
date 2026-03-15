'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Shield,
  CreditCard,
  Plug2,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import api from '@/lib/api';
import { platformDisplayName, platformColor, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/loading';
import type { PlatformConnection, Platform } from '@/types';
import toast from 'react-hot-toast';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

const allPlatforms: {
  platform: Platform;
  description: string;
}[] = [
  { platform: 'shopify', description: 'Connect your Shopify store' },
  { platform: 'amazon', description: 'Sell on Amazon marketplace' },
  { platform: 'ebay', description: 'List products on eBay' },
  { platform: 'etsy', description: 'Reach Etsy handmade shoppers' },
  { platform: 'woocommerce', description: 'WordPress WooCommerce store' },
  { platform: 'walmart', description: 'Walmart marketplace' },
];

const planFeatures: Record<string, string[]> = {
  free: ['1 platform', '50 products', 'Basic analytics'],
  starter: ['3 platforms', '500 products', 'Full analytics', 'Email support'],
  pro: [
    'Unlimited platforms',
    'Unlimited products',
    'Advanced analytics',
    'AI matching',
    'Priority support',
  ],
  enterprise: [
    'Everything in Pro',
    'Custom integrations',
    'Dedicated account manager',
    'SLA guarantee',
  ],
};

export default function SettingsPage() {
  const { user, tenant } = useAuthStore();
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchConnections() {
      try {
        const conns = await api.tenants.connections();
        setConnections(conns);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchConnections();
  }, []);

  const connectedPlatformIds = new Set(connections.map((c) => c.platform));

  if (loading) return <PageLoader />;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-4xl"
    >
      {/* Header */}
      <motion.div variants={item}>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-dashboard-muted mt-1">Manage your account and integrations</p>
      </motion.div>

      {/* Tenant Info */}
      <motion.div variants={item}>
        <Card>
          <CardHeader
            title="Organization"
            description="Your business information"
            action={<Button variant="outline" size="sm">Edit</Button>}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-dashboard-muted uppercase mb-1">
                Organization Name
              </label>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-dashboard-muted" />
                <span className="text-sm text-white">{tenant?.name || 'Not set'}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-dashboard-muted uppercase mb-1">
                Slug
              </label>
              <span className="text-sm text-dashboard-text font-mono">
                {tenant?.slug || '-'}
              </span>
            </div>
            <div>
              <label className="block text-xs text-dashboard-muted uppercase mb-1">
                Admin
              </label>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-dashboard-muted" />
                <span className="text-sm text-white">{user?.fullName}</span>
                <span className="text-xs text-dashboard-muted">({user?.email})</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-dashboard-muted uppercase mb-1">
                Member Since
              </label>
              <span className="text-sm text-dashboard-text">
                {tenant?.createdAt ? formatDate(tenant.createdAt) : '-'}
              </span>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Connected Platforms */}
      <motion.div variants={item}>
        <Card>
          <CardHeader
            title="Connected Platforms"
            description="Manage your e-commerce platform integrations"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allPlatforms.map(({ platform, description }) => {
              const connection = connections.find(
                (c) => c.platform === platform
              );
              const isConnected = !!connection;

              return (
                <div
                  key={platform}
                  className={`relative border rounded-xl p-4 transition-all ${
                    isConnected
                      ? 'border-accent-600/50 bg-accent-600/5'
                      : 'border-dashboard-border hover:border-dashboard-hover'
                  }`}
                >
                  {isConnected && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="w-5 h-5 text-accent-400" />
                    </div>
                  )}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-white font-bold text-sm"
                    style={{ backgroundColor: platformColor(platform) + '33' }}
                  >
                    {platformDisplayName(platform).slice(0, 2).toUpperCase()}
                  </div>
                  <h3 className="text-sm font-semibold text-white">
                    {platformDisplayName(platform)}
                  </h3>
                  <p className="text-xs text-dashboard-muted mt-0.5 mb-3">
                    {description}
                  </p>
                  {isConnected ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dashboard-muted">Store</span>
                        <span className="text-dashboard-text">
                          {connection.storeName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dashboard-muted">Status</span>
                        <Badge
                          variant={
                            connection.status === 'active'
                              ? 'success'
                              : connection.status === 'error'
                              ? 'danger'
                              : 'default'
                          }
                          dot
                        >
                          {connection.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Button variant="outline" size="sm" className="flex-1">
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Sync
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-400">
                          <Unplug className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full">
                      <Plug2 className="w-3.5 h-3.5 mr-1.5" />
                      Connect
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {/* Plan Info */}
      <motion.div variants={item}>
        <Card>
          <CardHeader
            title="Plan & Billing"
            description="Your current subscription plan"
            action={
              <Button variant="primary" size="sm">
                Upgrade Plan
              </Button>
            }
          />
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white capitalize">
                {tenant?.plan || 'free'} Plan
              </h3>
              <ul className="mt-2 space-y-1">
                {(planFeatures[tenant?.plan || 'free'] || []).map(
                  (feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm text-dashboard-text"
                    >
                      <CheckCircle2 className="w-4 h-4 text-accent-400 shrink-0" />
                      {feature}
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
