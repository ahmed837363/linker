'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import api from '@/lib/api';
import type { Product } from '@/types';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';

interface VariantForm {
  sku: string;
  title: string;
  basePrice: number;
  baseCurrency: string;
  stockQuantity: number;
  lowStockThreshold: number;
  barcode: string;
  weightGrams: number;
}

export default function NewProductPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditing = !!editId;

  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState('');
  const [variants, setVariants] = useState<VariantForm[]>([
    { sku: '', title: '', basePrice: 0, baseCurrency: 'USD', stockQuantity: 0, lowStockThreshold: 5, barcode: '', weightGrams: 0 },
  ]);

  useEffect(() => {
    if (editId) {
      api.products.get(editId).then((p) => {
        setTitle(p.title);
        setDescription(p.description || '');
        setCategory(p.category || '');
        setTags(p.tags?.join(', ') || '');
        setImages(p.images?.join('\n') || '');
        if (p.variants?.length) {
          setVariants(
            p.variants.map((v) => ({
              sku: v.sku,
              title: v.title || '',
              basePrice: v.price,
              baseCurrency: v.currency || 'USD',
              stockQuantity: v.stockQuantity,
              lowStockThreshold: v.lowStockThreshold,
              barcode: '',
              weightGrams: v.weight || 0,
            }))
          );
        }
      });
    }
  }, [editId]);

  function addVariant() {
    setVariants([
      ...variants,
      { sku: '', title: '', basePrice: 0, baseCurrency: 'USD', stockQuantity: 0, lowStockThreshold: 5, barcode: '', weightGrams: 0 },
    ]);
  }

  function updateVariant(idx: number, field: keyof VariantForm, value: string | number) {
    setVariants(variants.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  }

  function removeVariant(idx: number) {
    if (variants.length <= 1) return;
    setVariants(variants.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        title,
        description,
        brand,
        category,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        images: images.split('\n').filter(Boolean),
        variants,
      };
      if (isEditing) {
        await api.products.update(editId!, data as any);
      } else {
        await api.products.create(data as any);
      }
      router.push('/products');
    } catch {}
    setSaving(false);
  }

  return (
    <>
      <Breadcrumbs />
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-dashboard-hover text-dashboard-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-white">
          {isEditing ? 'Edit Product' : 'New Product'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
        {/* Basic Info */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-white">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-dashboard-muted mb-1">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full input-base"
                placeholder="Product title"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-dashboard-muted mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full input-base resize-none"
                placeholder="Product description..."
              />
            </div>
            <div>
              <label className="block text-sm text-dashboard-muted mb-1">Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full input-base"
                placeholder="Brand name"
              />
            </div>
            <div>
              <label className="block text-sm text-dashboard-muted mb-1">Category</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full input-base"
                placeholder="e.g. Electronics"
              />
            </div>
            <div>
              <label className="block text-sm text-dashboard-muted mb-1">Tags (comma-separated)</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full input-base"
                placeholder="e.g. new, sale, featured"
              />
            </div>
            <div>
              <label className="block text-sm text-dashboard-muted mb-1">Image URLs (one per line)</label>
              <textarea
                value={images}
                onChange={(e) => setImages(e.target.value)}
                rows={2}
                className="w-full input-base resize-none"
                placeholder="https://..."
              />
            </div>
          </div>
        </div>

        {/* Variants */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Variants</h2>
            <button
              type="button"
              onClick={addVariant}
              className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80"
            >
              <Plus className="w-4 h-4" /> Add Variant
            </button>
          </div>
          {variants.map((v, idx) => (
            <div
              key={idx}
              className="border border-dashboard-border rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-dashboard-muted font-medium">
                  Variant {idx + 1}
                </span>
                {variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(idx)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-dashboard-muted mb-1">SKU *</label>
                  <input
                    value={v.sku}
                    onChange={(e) => updateVariant(idx, 'sku', e.target.value)}
                    required
                    className="w-full input-base text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dashboard-muted mb-1">Title</label>
                  <input
                    value={v.title}
                    onChange={(e) => updateVariant(idx, 'title', e.target.value)}
                    className="w-full input-base text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dashboard-muted mb-1">Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={v.basePrice}
                    onChange={(e) => updateVariant(idx, 'basePrice', parseFloat(e.target.value) || 0)}
                    required
                    className="w-full input-base text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dashboard-muted mb-1">Stock</label>
                  <input
                    type="number"
                    value={v.stockQuantity}
                    onChange={(e) => updateVariant(idx, 'stockQuantity', parseInt(e.target.value) || 0)}
                    className="w-full input-base text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors font-medium"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : isEditing ? 'Update Product' : 'Create Product'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 rounded-lg bg-dashboard-hover text-dashboard-text hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
