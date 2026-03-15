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

const ZID_API_BASE = 'https://api.zid.sa/v1';
const ZID_OAUTH_BASE = 'https://oauth.zid.sa';

@Injectable()
export class ZidAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.zid;
  readonly displayName = 'Zid';
  readonly logoUrl = 'https://zid.sa/wp-content/themes/flavor/images/logos/zid-logo.svg';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(ZidAdapter.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('ZID_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('ZID_CLIENT_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async zidFetch<T = any>(
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${ZID_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Accept-Language': 'en',
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zid API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    return (
      `${ZID_OAUTH_BASE}/oauth/authorize` +
      `?client_id=${encodeURIComponent(this.clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const tokenRes = await fetch(`${ZID_OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Zid token exchange failed: ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      authorization: string;
    };

    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // Fetch store info using the manager token
    const storeInfo = await this.zidFetch<{
      store: { id: number; title: string; username: string };
    }>('/store/info', token.access_token);

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        managerToken: token.authorization,
      },
      shopId: String(storeInfo.store?.id ?? ''),
      shopName: storeInfo.store?.title ?? storeInfo.store?.username ?? 'Zid Store',
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const tokenRes = await fetch(`${ZID_OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: creds.refreshToken,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Zid refresh failed: ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      authorization: string;
    };
    return {
      ...creds,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      managerToken: token.authorization,
    };
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 30;

    const res = await this.zidFetch<{
      products: any[];
      pagination: { total_pages: number; current_page: number };
    }>(`/products?page=${page}&per_page=${limit}`, creds.accessToken);

    const products: NormalizedProduct[] = (res.products ?? []).map((p: any) => ({
      platformProductId: String(p.id),
      title: p.name ?? p.title ?? '',
      description: p.description ?? undefined,
      brand: p.brand?.name ?? undefined,
      category: p.categories?.[0]?.name ?? undefined,
      tags: p.tags ?? [],
      images: (p.images ?? []).map((img: any, idx: number) => ({
        url: img.url ?? img.original,
        platformImageId: String(img.id ?? idx),
        position: idx,
        altText: img.alt_text ?? undefined,
      })),
      variants: (p.variants ?? [p]).map((v: any) => ({
        platformVariantId: String(v.id ?? p.id),
        sku: v.sku ?? undefined,
        barcode: v.barcode ?? undefined,
        title: v.name ?? p.name,
        options: v.attributes ?? {},
        price: parseFloat(v.price ?? p.price ?? '0'),
        currency: 'SAR',
        stockQuantity: v.quantity ?? v.stock ?? 0,
      })),
      status: p.is_published ? 'active' : 'draft',
      platformUrl: p.url ?? undefined,
    }));

    const totalPages = res.pagination?.total_pages ?? 1;
    const nextCursor = page < totalPages ? String(page + 1) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.zidFetch<{ product: any }>(
      `/products/${productId}`,
      creds.accessToken,
    );
    return (res.product?.images ?? []).map((img: any, idx: number) => ({
      url: img.url ?? img.original,
      platformImageId: String(img.id ?? idx),
      position: idx,
      altText: img.alt_text ?? undefined,
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
      price: product.variants[0]?.price ?? 0,
      sku: product.variants[0]?.sku ?? '',
      quantity: product.variants[0]?.stockQuantity ?? 0,
      images: (product.images ?? []).map((img) => ({ url: img.url })),
    };

    const res = await this.zidFetch<{ product: { id: number } }>(
      '/products',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return {
      platformProductId: String(res.product.id),
      platformVariantIds: [String(res.product.id)],
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
      update.is_published = changes.status === 'active';
    }

    await this.zidFetch(
      `/products/${platformProductId}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify(update) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const res = await this.zidFetch<{ products: any[] }>(
      `/products?sku=${encodeURIComponent(sku)}&per_page=1`,
      creds.accessToken,
    );
    const product = res.products?.[0];
    if (!product) throw new Error(`SKU "${sku}" not found on Zid`);
    return product.quantity ?? product.stock ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    const res = await this.zidFetch<{ products: any[] }>(
      `/products?sku=${encodeURIComponent(sku)}&per_page=1`,
      creds.accessToken,
    );
    const product = res.products?.[0];
    if (!product) throw new Error(`SKU "${sku}" not found on Zid`);

    await this.zidFetch(
      `/products/${product.id}/inventory`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify({ quantity }) },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const res = await this.zidFetch<{ orders: any[] }>(
      `/orders?created_from=${since.toISOString()}&per_page=100`,
      creds.accessToken,
    );

    return (res.orders ?? []).map((o: any) => ({
      platformOrderId: String(o.id),
      status: o.status ?? 'unknown',
      currency: o.currency ?? 'SAR',
      subtotal: parseFloat(o.sub_total ?? '0'),
      taxTotal: parseFloat(o.tax_total ?? '0'),
      shippingTotal: parseFloat(o.shipping_cost ?? '0'),
      grandTotal: parseFloat(o.total ?? '0'),
      customer: o.customer
        ? {
            email: o.customer.email,
            firstName: o.customer.first_name,
            lastName: o.customer.last_name,
            phone: o.customer.mobile,
          }
        : undefined,
      shippingAddress: o.shipping_address
        ? {
            name: o.shipping_address.name,
            addressLine1: o.shipping_address.street,
            city: o.shipping_address.city,
            province: o.shipping_address.state,
            postalCode: o.shipping_address.postal_code,
            country: o.shipping_address.country,
            phone: o.shipping_address.phone,
          }
        : undefined,
      items: (o.items ?? []).map((li: any) => ({
        platformLineItemId: String(li.id),
        sku: li.sku ?? undefined,
        title: li.name,
        quantity: li.quantity ?? 1,
        unitPrice: parseFloat(li.price ?? '0'),
        totalPrice: parseFloat(li.total ?? '0'),
      })),
      placedAt: new Date(o.created_at),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const signature =
      headers['x-zid-signature'] ?? headers['X-Zid-Signature'] ?? '';
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const rawEvent = payload.event ?? 'unknown';

    const topicMap: Record<string, string> = {
      'product.created': 'product.created',
      'product.updated': 'product.updated',
      'product.deleted': 'product.deleted',
      'order.created': 'order.created',
      'order.updated': 'order.updated',
      'inventory.updated': 'inventory.updated',
      'app.uninstalled': 'app.uninstalled',
    };

    return {
      topic: topicMap[rawEvent] ?? rawEvent,
      platformTopic: rawEvent,
      idempotencyKey: payload.webhook_id ?? crypto.randomUUID(),
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
    await this.zidFetch(
      '/webhooks',
      creds.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          event: topic,
          url: callbackUrl,
        }),
      },
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    return { requestsPerSecond: 4, burstLimit: 40 };
  }
}
