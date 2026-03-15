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

/**
 * Noon Seller API.
 * Noon uses API-key authentication and feed-based catalog management.
 * Base URL differs by environment (sandbox / production) and region.
 */
const NOON_API_BASE_UAE = 'https://api.noon.partners/seller/api/v1';
const NOON_API_BASE_KSA = 'https://api.noon.partners/seller/api/v1';
const NOON_API_BASE_EGYPT = 'https://api.noon.partners/seller/api/v1';

@Injectable()
export class NoonAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.noon;
  readonly displayName = 'Noon';
  readonly logoUrl = 'https://www.noon.com/favicon.ico';
  readonly authType: AuthType = 'api_key';

  private readonly logger = new Logger(NoonAdapter.name);

  constructor(private readonly config: ConfigService) {}

  // ── Helpers ─────────────────────────────────────────────────────────────

  private baseUrl(credentials: any): string {
    const region: string = credentials.region ?? 'uae';
    if (region === 'ksa') return NOON_API_BASE_KSA;
    if (region === 'egypt') return NOON_API_BASE_EGYPT;
    return NOON_API_BASE_UAE;
  }

  private async noonFetch<T = any>(
    credentials: any,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl(credentials)}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.apiKey}`,
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Noon API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(_tenantId: string, _redirectUri: string): string {
    // Noon uses API-key authentication. There is no OAuth flow.
    // The frontend should show an input form for the seller's API key.
    return 'noon://api-key-entry';
  }

  async handleAuthCallback(code: string, _state: string): Promise<AuthCallbackResult> {
    // For Noon the "code" parameter carries the serialised API key + metadata
    // submitted by the frontend's manual-entry form.
    const data = JSON.parse(code) as {
      apiKey: string;
      sellerId: string;
      shopName?: string;
      region?: string;
    };

    // Validate the key by calling a lightweight endpoint
    const creds = { apiKey: data.apiKey, region: data.region ?? 'uae' };
    const profile = await this.noonFetch<{ result: { sellerId: string; sellerName: string } }>(
      creds,
      '/seller/profile',
    );

    return {
      credentials: {
        apiKey: data.apiKey,
        region: data.region ?? 'uae',
        sellerId: profile.result?.sellerId ?? data.sellerId,
      },
      shopId: profile.result?.sellerId ?? data.sellerId,
      shopName: profile.result?.sellerName ?? data.shopName ?? 'Noon Seller',
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    // API keys do not expire (they can be regenerated in Noon Seller Lab).
    return credentials;
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 50;

    const res = await this.noonFetch<{
      result: { items: any[]; totalCount: number };
    }>(creds, `/catalog/items?page=${page}&limit=${limit}`);

    const products: NormalizedProduct[] = (res.result?.items ?? []).map((item: any) => ({
      platformProductId: item.sku ?? item.partnerSku ?? String(item.id),
      title: item.title ?? item.productName ?? '',
      description: item.description ?? undefined,
      brand: item.brand ?? undefined,
      category: item.categoryPath ?? item.category ?? undefined,
      tags: [],
      images: (item.images ?? []).map((url: string, idx: number) => ({
        url,
        position: idx,
      })),
      variants: [
        {
          platformVariantId: item.sku ?? item.partnerSku ?? String(item.id),
          sku: item.partnerSku ?? item.sku,
          barcode: item.barcode ?? item.ean ?? undefined,
          title: item.title ?? '',
          options: {},
          price: parseFloat(item.salePrice ?? item.price ?? '0'),
          currency: creds.region === 'egypt' ? 'EGP' : creds.region === 'ksa' ? 'SAR' : 'AED',
          stockQuantity: item.stockQuantity ?? item.quantity ?? 0,
        },
      ],
      status: item.status === 'live' ? 'active' : 'draft',
    }));

    const hasMore = res.result?.items?.length >= limit;
    return { products, nextCursor: hasMore ? String(page + 1) : undefined };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.noonFetch<{ result: any }>(
      creds,
      `/catalog/items/${productId}`,
    );
    return (res.result?.images ?? []).map((url: string, idx: number) => ({
      url,
      position: idx,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    // Noon uses a feed-based approach: create a feed, upload items, wait for processing.
    const feedItems = product.variants.map((v) => ({
      partnerSku: v.sku,
      title: product.title,
      description: product.description ?? '',
      brand: product.brand ?? '',
      category: product.category ?? '',
      barcode: v.barcode ?? '',
      salePrice: v.price,
      quantity: v.stockQuantity ?? 0,
      images: (product.images ?? []).map((img) => img.url),
    }));

    const feedRes = await this.noonFetch<{ result: { feedId: string } }>(
      creds,
      '/catalog/feeds',
      {
        method: 'POST',
        body: JSON.stringify({
          feedType: 'create_items',
          items: feedItems,
        }),
      },
    );

    const feedId = feedRes.result?.feedId ?? 'unknown';
    return {
      platformProductId: feedId,
      platformVariantIds: product.variants.map((v) => v.sku),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const update: Record<string, unknown> = { partnerSku: platformProductId };
    if (changes.title !== undefined) update.title = changes.title;
    if (changes.description !== undefined) update.description = changes.description;
    if (changes.price !== undefined) update.salePrice = changes.price;
    if (changes.images !== undefined) {
      update.images = changes.images.map((img) => img.url);
    }

    await this.noonFetch(creds, '/catalog/feeds', {
      method: 'POST',
      body: JSON.stringify({
        feedType: 'update_items',
        items: [update],
      }),
    });
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const res = await this.noonFetch<{ result: { quantity: number } }>(
      creds,
      `/inventory/items/${encodeURIComponent(sku)}`,
    );
    return res.result?.quantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    await this.noonFetch(creds, '/inventory/feeds', {
      method: 'POST',
      body: JSON.stringify({
        feedType: 'stock_update',
        items: [{ partnerSku: sku, quantity }],
      }),
    });
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const fromDate = since.toISOString().split('T')[0];

    const res = await this.noonFetch<{ result: { orders: any[] } }>(
      creds,
      `/orders?fromDate=${fromDate}&page=1&limit=100`,
    );

    return (res.result?.orders ?? []).map((o: any) => ({
      platformOrderId: String(o.orderId ?? o.order_nr),
      status: o.status ?? 'unknown',
      currency: o.currency ?? (creds.region === 'egypt' ? 'EGP' : creds.region === 'ksa' ? 'SAR' : 'AED'),
      subtotal: parseFloat(o.subtotal ?? '0'),
      taxTotal: parseFloat(o.taxAmount ?? '0'),
      shippingTotal: parseFloat(o.shippingAmount ?? '0'),
      grandTotal: parseFloat(o.total ?? o.grandTotal ?? '0'),
      customer: o.customer
        ? {
            firstName: o.customer.firstName,
            lastName: o.customer.lastName,
            phone: o.customer.phone,
          }
        : undefined,
      shippingAddress: o.shippingAddress
        ? {
            name: o.shippingAddress.name,
            addressLine1: o.shippingAddress.addressLine1,
            addressLine2: o.shippingAddress.addressLine2,
            city: o.shippingAddress.city,
            province: o.shippingAddress.state,
            postalCode: o.shippingAddress.postalCode,
            country: o.shippingAddress.countryCode,
            phone: o.shippingAddress.phone,
          }
        : undefined,
      items: (o.items ?? []).map((li: any) => ({
        platformLineItemId: String(li.itemId ?? li.id),
        sku: li.partnerSku ?? li.sku ?? undefined,
        title: li.title ?? li.productName,
        quantity: li.quantity ?? 1,
        unitPrice: parseFloat(li.unitPrice ?? li.salePrice ?? '0'),
        totalPrice: parseFloat(li.totalPrice ?? '0'),
      })),
      placedAt: new Date(o.createdAt ?? o.orderDate),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    // Noon sends an HMAC-SHA256 signature in the x-noon-signature header.
    const signature =
      headers['x-noon-signature'] ?? headers['X-Noon-Signature'] ?? '';
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
    const eventType = payload.event ?? payload.eventType ?? 'unknown';

    const topicMap: Record<string, string> = {
      item_created: 'product.created',
      item_updated: 'product.updated',
      order_created: 'order.created',
      order_status_changed: 'order.updated',
      stock_updated: 'inventory.updated',
    };

    return {
      topic: topicMap[eventType] ?? eventType,
      platformTopic: eventType,
      idempotencyKey: payload.eventId ?? payload.id ?? crypto.randomUUID(),
      payload: payload.data ?? payload,
      occurredAt: payload.timestamp ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    const topicMap: Record<string, string> = {
      'product.created': 'item_created',
      'product.updated': 'item_updated',
      'order.created': 'order_created',
      'order.updated': 'order_status_changed',
      'inventory.updated': 'stock_updated',
    };

    await this.noonFetch(creds, '/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        event: topicMap[topic] ?? topic,
        url: callbackUrl,
      }),
    });
  }

  getRateLimitConfig(): RateLimitConfig {
    return { requestsPerSecond: 5, burstLimit: 30 };
  }
}
