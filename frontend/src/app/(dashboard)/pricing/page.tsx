'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  ToggleLeft,
  ToggleRight,
  DollarSign,
} from 'lucide-react';
import api from '@/lib/api';
import { platformDisplayName, platformBgClass } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader } from '@/components/ui/loading';
import { Modal } from '@/components/ui/modal';
import type { PricingRule, PricingRuleType, Platform } from '@/types';
import toast from 'react-hot-toast';

const ruleTypeLabels: Record<PricingRuleType, string> = {
  markup: 'Markup',
  markdown: 'Markdown',
  fixed: 'Fixed Price',
  match_lowest: 'Match Lowest',
  round: 'Price Rounding',
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<PricingRuleType>('markup');
  const [formPlatform, setFormPlatform] = useState<Platform | 'all'>('all');
  const [formAdjustment, setFormAdjustment] = useState(0);
  const [formIsPercentage, setFormIsPercentage] = useState(true);

  useEffect(() => {
    fetchRules();
  }, []);

  async function fetchRules() {
    setLoading(true);
    try {
      const data = await api.pricing.listRules();
      setRules(data);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingRule(null);
    setFormName('');
    setFormType('markup');
    setFormPlatform('all');
    setFormAdjustment(0);
    setFormIsPercentage(true);
    setShowModal(true);
  }

  function openEdit(rule: PricingRule) {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormType(rule.type);
    setFormPlatform(rule.platform);
    setFormAdjustment(rule.adjustment);
    setFormIsPercentage(rule.isPercentage);
    setShowModal(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      toast.error('Please enter a rule name');
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: formName,
        type: formType,
        platform: formPlatform,
        adjustment: formAdjustment,
        isPercentage: formIsPercentage,
      };
      if (editingRule) {
        await api.pricing.updateRule(editingRule.id, data);
        toast.success('Rule updated');
      } else {
        await api.pricing.createRule(data);
        toast.success('Rule created');
      }
      setShowModal(false);
      fetchRules();
    } catch {
      toast.error('Failed to save rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.pricing.deleteRule(id);
      toast.success('Rule deleted');
      fetchRules();
    } catch {
      toast.error('Failed to delete rule');
    }
  }

  async function handleToggle(rule: PricingRule) {
    try {
      await api.pricing.updateRule(rule.id, { isActive: !rule.isActive });
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, isActive: !r.isActive } : r
        )
      );
      toast.success(rule.isActive ? 'Rule deactivated' : 'Rule activated');
    } catch {
      toast.error('Failed to toggle rule');
    }
  }

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
          <h1 className="text-2xl font-bold text-white">Pricing Rules</h1>
          <p className="text-dashboard-muted mt-1">
            Manage automated pricing strategies across platforms
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={openCreate}>
          Create Rule
        </Button>
      </motion.div>

      {/* Rules List */}
      {rules.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="w-8 h-8 text-dashboard-muted" />}
          title="No pricing rules"
          description="Create rules to automate price adjustments across your platforms."
          actionLabel="Create First Rule"
          onAction={openCreate}
        />
      ) : (
        <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className={`relative ${!rule.isActive ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{rule.name}</h3>
                  <Badge className="mt-1" variant="info">
                    {ruleTypeLabels[rule.type]}
                  </Badge>
                </div>
                <button
                  onClick={() => handleToggle(rule)}
                  className="text-dashboard-muted hover:text-white transition-colors"
                >
                  {rule.isActive ? (
                    <ToggleRight className="w-7 h-7 text-accent-400" />
                  ) : (
                    <ToggleLeft className="w-7 h-7" />
                  )}
                </button>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-dashboard-muted">Platform</span>
                  {rule.platform === 'all' ? (
                    <span className="text-dashboard-text">All Platforms</span>
                  ) : (
                    <Badge className={platformBgClass(rule.platform as Platform)}>
                      {platformDisplayName(rule.platform as Platform)}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-dashboard-muted">Adjustment</span>
                  <span className="text-white font-medium">
                    {rule.adjustment > 0 ? '+' : ''}
                    {rule.adjustment}
                    {rule.isPercentage ? '%' : ' (fixed)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-dashboard-muted">Priority</span>
                  <span className="text-dashboard-text">{rule.priority}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-dashboard-border pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Pencil className="w-3.5 h-3.5" />}
                  onClick={() => openEdit(rule)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                  className="text-red-400 hover:text-red-300"
                  onClick={() => handleDelete(rule.id)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingRule ? 'Edit Pricing Rule' : 'Create Pricing Rule'}
        description="Define how prices should be adjusted for a platform"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dashboard-text mb-1.5">
              Rule Name
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g., Amazon 15% Markup"
              className="input-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dashboard-text mb-1.5">
              Rule Type
            </label>
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value as PricingRuleType)}
              className="input-base"
            >
              {Object.entries(ruleTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-dashboard-text mb-1.5">
              Platform
            </label>
            <select
              value={formPlatform}
              onChange={(e) => setFormPlatform(e.target.value as Platform | 'all')}
              className="input-base"
            >
              <option value="all">All Platforms</option>
              <option value="shopify">Shopify</option>
              <option value="amazon">Amazon</option>
              <option value="ebay">eBay</option>
              <option value="etsy">Etsy</option>
              <option value="woocommerce">WooCommerce</option>
              <option value="walmart">Walmart</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-dashboard-text mb-1.5">
              Adjustment
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={formAdjustment}
                onChange={(e) => setFormAdjustment(parseFloat(e.target.value) || 0)}
                className="input-base flex-1"
                step="0.01"
              />
              <div className="flex items-center border border-dashboard-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setFormIsPercentage(true)}
                  className={`px-3 py-2 text-sm ${
                    formIsPercentage
                      ? 'bg-primary-600 text-white'
                      : 'text-dashboard-muted hover:text-white'
                  }`}
                >
                  %
                </button>
                <button
                  onClick={() => setFormIsPercentage(false)}
                  className={`px-3 py-2 text-sm ${
                    !formIsPercentage
                      ? 'bg-primary-600 text-white'
                      : 'text-dashboard-muted hover:text-white'
                  }`}
                >
                  $
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} isLoading={saving}>
              {editingRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
