import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  AuthCallbackResult,
  AuthType,
  ListingChanges,
  NormalizedOrder,
  NormalizedProduct,
  NormalizedWebhookEvent,
  PaginationCursor,
  PlatformAdapter,
  PlatformCredentials,
  PlatformImage,
  PlatformType,
  PushProductPayload,
  RateLimitConfig,
} from '../platform.interface';

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';
const SALLA_OAUTH_BASE = 'https://accounts.salla.sa/oauth2';

@Injectable()
export class SallaAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.salla;
  readonly displayName = 'Salla';
  readonly logoUrl = 'https://cdn.salla.sa/images/logo/logo-square.png';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(SallaAdapter.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('SALLA_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('SALLA_CLIENT_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async sallaFetch<T = any>(
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${SALLA_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Salla API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    return (
      `${SALLA_OAUTH_BASE}/auth` +
      `?client_id=${encodeURIComponent(this.clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=offline_access` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const res = await fetch(`${SALLA_OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: '', // Salla expects the same redirect_uri used during auth
      }),
    });
    if (!res.ok) throw new Error(`Salla token exchange failed: ${await res.text()}`);
    const token = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };

    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // Fetch store info
    const storeInfo = await this.sallaFetch<{
      data: { id: number; name: string; domain: string };
    }>('/store/info', token.access_token);

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        scope: token.scope,
      },
      shopId: String(storeInfo.data.id),
      shopName: storeInfo.data.name,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const res = await fetch(`${SALLA_OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: creds.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Salla refresh failed: ${await res.text()}`);
    const token = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    };
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 50;

    const res = await this.sallaFetch<{
      data: any[];
      cursor: { next: string | null; current: number };
    }>(`/products?page=${page}&per_page=${limit}`, creds.accessToken);

    const products: NormalizedProduct[] = res.data.map((p: any) => ({
      platformProductId: String(p.id),
      title: p.name,
      description: p.description ?? undefined,
      brand: p.brand?.name ?? undefined,
      category: p.categories?.[0]?.name ?? undefined,
      tags: p.tags ?? [],
      images: (p.images ?? []).map((img: any, idx: number) => ({
        url: img.url ?? img.original,
        platformImageId: String(img.id),
        position: idx,
        altText: img.alt ?? undefined,
      })),
      variants: (p.skus ?? [p]).map((v: any) => ({
        platformVariantId: String(v.id),
        sku: v.sku ?? undefined,
        barcode: v.mpn ?? v.gtin ?? undefined,
        title: v.name ?? p.name,
        options: v.options ?? {},
        price: parseFloat(v.price?.amount ?? v.price ?? p.price?.amount ?? '0'),
        currency: v.price?.currency ?? p.price?.currency ?? 'SAR',
        stockQuantity: v.quantity ?? v.stock_quantity ?? 0,
      })),
      status: p.status === 'sale' ? 'active' : 'draft',
      platformUrl: p.url ?? undefined,
    }));

    const nextCursor = res.cursor?.next ? String(page + 1) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.sallaFetch<{ data: any }>(
      `/products/${productId}`,
      creds.accessToken,
    );
    return (res.data.images ?? []).map((img: any, idx: number) => ({
      url: img.url ?? img.original,
      platformImageId: String(img.id),
      position: idx,
      altText: img.alt ?? undefined,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const body = {
      name: product.title,
      description: product.description ?? '',
      product_type: 'product',
      price: product.variants[0]?.price ?? 0,
      quantity: product.variants[0]?.stockQuantity ?? 0,
      sku: product.variants[0]?.sku ?? '',
      images: (product.images ?? []).map((img) => ({ url: img.url })),
    };

    const res = await this.sallaFetch<{ data: { id: number } }>(
      '/products',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return {
      platformProductId: String(res.data.id),
      platformVariantIds: [String(res.data.id)],
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const update: Record<string, unknown> = {};
    if (changes.title !== undefined) update.name = changes.title;
    if (changes.description !== undefined) update.description = changes.description;
    if (changes.price !== undefined) update.price = changes.price;
    if (changes.status !== undefined) {
      update.status = changes.status === 'active' ? 'sale' : 'hidden';
    }

    await this.sallaFetch(
      `/products/${platformProductId}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify(update) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const res = await this.sallaFetch<{ data: any[] }>(
      `/products?sku=${encodeURIComponent(sku)}&per_page=1`,
      creds.accessToken,
    );
    const product = res.data[0];
    if (!product) throw new Error(`SKU "${sku}" not found on Salla`);
    return product.quantity ?? product.stock_quantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    // Find product by SKU first
    const res = await this.sallaFetch<{ data: any[] }>(
      `/products?sku=${encodeURIComponent(sku)}&per_page=1`,
      creds.accessToken,
    );
    const product = res.data[0];
    if (!product) throw new Error(`SKU "${sku}" not found on Salla`);

    await this.sallaFetch(
      `/products/${product.id}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify({ quantity }) },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const res = await this.sallaFetch<{ data: any[] }>(
      `/orders?from_date=${since.toISOString().split('T')[0]}&per_page=100`,
      creds.accessToken,
    );

    return res.data.map((o: any) => ({
      platformOrderId: String(o.id),
      status: o.status?.slug ?? o.status ?? 'unknown',
      currency: o.amounts?.currency_code ?? o.currency ?? 'SAR',
      subtotal: parseFloat(o.amounts?.sub_total?.amount ?? o.sub_total ?? '0'),
      taxTotal: parseFloat(o.amounts?.tax?.amount ?? o.tax ?? '0'),
      shippingTotal: parseFloat(o.amounts?.shipping_cost?.amount ?? o.shipping ?? '0'),
      grandTotal: parseFloat(o.amounts?.total?.amount ?? o.total ?? '0'),
      customer: o.customer
        ? {
            email: o.customer.email,
            firstName: o.customer.first_name,
            lastName: o.customer.last_name,
            phone: o.customer.mobile,
          }
        : undefined,
      shippingAddress: o.shipping?.address
        ? {
            name: `${o.shipping.address.first_name ?? ''} ${o.shipping.address.last_name ?? ''}`.trim(),
            addressLine1: o.shipping.address.street,
            city: o.shipping.address.city,
            province: o.shipping.address.state,
            postalCode: o.shipping.address.postal_code,
            country: o.shipping.address.country,
            phone: o.shipping.address.phone,
          }
        : undefined,
      items: (o.items ?? []).map((li: any) => ({
        platformLineItemId: String(li.id),
        sku: li.sku ?? undefined,
        title: li.name,
        quantity: li.quantity,
        unitPrice: parseFloat(li.amounts?.price_without_tax?.amount ?? li.price ?? '0'),
        totalPrice: parseFloat(li.amounts?.total?.amount ?? li.total ?? '0'),
      })),
      placedAt: new Date(o.date?.date ?? o.created_at),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const signature =
      headers['x-salla-signature'] ?? headers['X-Salla-Signature'] ?? '';
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signature),
    );
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const rawEvent = payload.event ?? 'unknown';
    const deliveryId =
      headers['x-salla-delivery-id'] ??
      headers['X-Salla-Delivery-Id'] ??
      payload.merchant ?? crypto.randomUUID();

    const topicMap: Record<string, string> = {
      'product.created': 'product.created',
      'product.updated': 'product.updated',
      'product.deleted': 'product.deleted',
      'order.created': 'order.created',
      'order.updated': 'order.updated',
      'order.cancelled': 'order.cancelled',
      'inventory.updated': 'inventory.updated',
      'app.store.authorize': 'app.uninstalled',
    };

    return {
      topic: topicMap[rawEvent] ?? rawEvent,
      platformTopic: rawEvent,
      idempotencyKey: deliveryId,
      payload: payload.data ?? payload,
      occurredAt: payload.created_at ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    await this.sallaFetch(
      '/webhooks/subscribe',
      creds.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          name: topic,
          event: topic,
          url: callbackUrl,
          headers: [],
        }),
      },
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    return { requestsPerSecond: 4, burstLimit: 120 };
  }
}
