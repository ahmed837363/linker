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

const WALMART_TOKEN_URL = 'https://marketplace.walmartapis.com/v3/token';
const WALMART_API_BASE = 'https://marketplace.walmartapis.com/v3';

@Injectable()
export class WalmartAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.walmart;
  readonly displayName = 'Walmart';
  readonly logoUrl = 'https://upload.wikimedia.org/wikipedia/commons/c/ca/Walmart_logo.svg';
  readonly authType: AuthType = 'custom';

  private readonly logger = new Logger(WalmartAdapter.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('WALMART_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('WALMART_CLIENT_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private basicAuth(): string {
    return Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  private async getAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    const res = await fetch(WALMART_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.basicAuth()}`,
        'WM_SVC.NAME': 'Linker Pro',
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Walmart token request failed: ${await res.text()}`);
    return res.json() as Promise<{ access_token: string; expires_in: number }>;
  }

  private async walmartFetch<T = any>(
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${WALMART_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'WM_SVC.NAME': 'Linker Pro',
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Walmart API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    // Walmart Marketplace uses client credentials -- no user-facing OAuth flow.
    // The frontend should prompt for Client ID + Client Secret.
    return 'walmart://client-credentials-entry';
  }

  async handleAuthCallback(code: string, _state: string): Promise<AuthCallbackResult> {
    // "code" carries the JSON with the seller's client_id and client_secret
    const data = JSON.parse(code) as {
      clientId: string;
      clientSecret: string;
      sellerId?: string;
      shopName?: string;
    };

    // Override instance-level credentials with seller-specific ones
    const token = await (async () => {
      const res = await fetch(WALMART_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${data.clientId}:${data.clientSecret}`).toString('base64')}`,
          'WM_SVC.NAME': 'Linker Pro',
          'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) throw new Error(`Walmart auth failed: ${await res.text()}`);
      return res.json() as Promise<{ access_token: string; expires_in: number }>;
    })();

    return {
      credentials: {
        accessToken: token.access_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        walmartClientId: data.clientId,
        walmartClientSecret: data.clientSecret,
      },
      shopId: data.sellerId ?? data.clientId,
      shopName: data.shopName ?? 'Walmart Seller',
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const res = await fetch(WALMART_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${creds.walmartClientId}:${creds.walmartClientSecret}`).toString('base64')}`,
        'WM_SVC.NAME': 'Linker Pro',
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Walmart refresh failed: ${await res.text()}`);
    const token = (await res.json()) as { access_token: string; expires_in: number };
    return {
      ...creds,
      accessToken: token.access_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    };
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const limit = pagination?.limit ?? 20;
    const offset = pagination?.cursor ? parseInt(pagination.cursor, 10) : 0;

    const res = await this.walmartFetch<{
      ItemResponse: any[];
      totalItems: number;
      nextCursor?: string;
    }>(`/items?limit=${limit}&offset=${offset}`, creds.accessToken);

    const products: NormalizedProduct[] = (res.ItemResponse ?? []).map((item: any) => ({
      platformProductId: item.sku ?? item.wpid ?? String(item.itemId),
      title: item.productName ?? '',
      description: item.shortDescription ?? item.longDescription ?? undefined,
      brand: item.brand ?? undefined,
      category: item.productCategory ?? undefined,
      tags: [],
      images: item.mainImageUrl
        ? [{ url: item.mainImageUrl, position: 0 }]
        : [],
      variants: [
        {
          platformVariantId: item.sku ?? item.wpid,
          sku: item.sku,
          barcode: item.upc ?? item.gtin ?? undefined,
          title: item.productName ?? '',
          options: {},
          price: parseFloat(item.price?.amount ?? item.currentPrice ?? '0'),
          currency: item.price?.currency ?? 'USD',
          stockQuantity: 0, // Inventory fetched separately
        },
      ],
      status: item.publishedStatus === 'PUBLISHED' ? 'active' : 'draft',
    }));

    const nextOffset = offset + limit;
    const nextCursor = nextOffset < (res.totalItems ?? 0) ? String(nextOffset) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const item = await this.walmartFetch<any>(
      `/items/${encodeURIComponent(productId)}`,
      creds.accessToken,
    );
    const images: PlatformImage[] = [];
    if (item.mainImageUrl) images.push({ url: item.mainImageUrl, position: 0 });
    (item.additionalImageUrls ?? []).forEach((url: string, idx: number) => {
      images.push({ url, position: idx + 1 });
    });
    return images;
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const variant = product.variants[0];

    // Walmart uses feed-based item creation
    const feedPayload = {
      ItemFeedHeader: {
        sellingChannel: 'marketplace',
        processMode: 'REPLACE',
        locale: 'en',
      },
      Item: product.variants.map((v) => ({
        sku: v.sku,
        productIdentifiers: v.barcode
          ? [{ productIdType: 'UPC', productId: v.barcode }]
          : [],
        productName: product.title,
        shortDescription: product.description ?? '',
        brand: product.brand ?? '',
        mainImageUrl: product.images?.[0]?.url ?? '',
        price: v.price,
        ShippingWeight: v.weightGrams ? v.weightGrams / 1000 : undefined,
      })),
    };

    const feedRes = await this.walmartFetch<{ feedId: string }>(
      '/feeds?feedType=item',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(feedPayload) },
    );

    return {
      platformProductId: feedRes.feedId ?? variant.sku,
      platformVariantIds: product.variants.map((v) => v.sku),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const update: Record<string, unknown> = { sku: platformProductId };
    if (changes.title !== undefined) update.productName = changes.title;
    if (changes.description !== undefined) update.shortDescription = changes.description;
    if (changes.price !== undefined) {
      // Walmart price update goes through a separate pricing feed
      await this.walmartFetch('/price', creds.accessToken, {
        method: 'PUT',
        body: JSON.stringify({
          sku: platformProductId,
          pricing: [
            {
              currentPriceType: 'BASE',
              currentPrice: { amount: changes.price, currency: 'USD' },
            },
          ],
        }),
      });
    }

    // Update item details via feed
    if (Object.keys(update).length > 1) {
      await this.walmartFetch('/feeds?feedType=item', creds.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          ItemFeedHeader: { sellingChannel: 'marketplace', processMode: 'REPLACE' },
          Item: [update],
        }),
      });
    }
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const res = await this.walmartFetch<{
      sku: string;
      quantity: { unit: string; amount: number };
    }>(`/inventory?sku=${encodeURIComponent(sku)}`, creds.accessToken);
    return res.quantity?.amount ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    await this.walmartFetch('/inventory', creds.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        sku,
        quantity: { unit: 'EACH', amount: quantity },
      }),
    });
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const createdStartDate = since.toISOString();

    const res = await this.walmartFetch<{
      list: { elements: { order: any[] } };
    }>(
      `/orders?createdStartDate=${encodeURIComponent(createdStartDate)}&limit=100`,
      creds.accessToken,
    );

    return (res.list?.elements?.order ?? []).map((o: any) => ({
      platformOrderId: o.purchaseOrderId,
      status: o.orderStatus ?? 'unknown',
      currency: 'USD',
      subtotal: parseFloat(o.orderLines?.orderLine?.reduce(
        (sum: number, li: any) => sum + parseFloat(li.charges?.charge?.[0]?.chargeAmount?.amount ?? '0'),
        0,
      ) ?? '0'),
      taxTotal: parseFloat(o.orderLines?.orderLine?.reduce(
        (sum: number, li: any) => sum + parseFloat(li.charges?.charge?.[0]?.tax?.taxAmount?.amount ?? '0'),
        0,
      ) ?? '0'),
      shippingTotal: 0,
      grandTotal: parseFloat(o.orderLines?.orderLine?.reduce(
        (sum: number, li: any) => sum + parseFloat(li.charges?.charge?.[0]?.chargeAmount?.amount ?? '0'),
        0,
      ) ?? '0'),
      customer: o.shippingInfo?.postalAddress
        ? {
            firstName: o.shippingInfo.postalAddress.name?.split(' ')[0],
            lastName: o.shippingInfo.postalAddress.name?.split(' ').slice(1).join(' '),
            phone: o.shippingInfo.phone,
          }
        : undefined,
      shippingAddress: o.shippingInfo?.postalAddress
        ? {
            name: o.shippingInfo.postalAddress.name,
            addressLine1: o.shippingInfo.postalAddress.address1,
            addressLine2: o.shippingInfo.postalAddress.address2,
            city: o.shippingInfo.postalAddress.city,
            province: o.shippingInfo.postalAddress.state,
            postalCode: o.shippingInfo.postalAddress.postalCode,
            country: o.shippingInfo.postalAddress.country,
          }
        : undefined,
      items: (o.orderLines?.orderLine ?? []).map((li: any) => ({
        platformLineItemId: li.lineNumber,
        sku: li.item?.sku ?? undefined,
        title: li.item?.productName,
        quantity: li.orderLineQuantity?.amount ?? 1,
        unitPrice: parseFloat(li.charges?.charge?.[0]?.chargeAmount?.amount ?? '0'),
        totalPrice: parseFloat(li.charges?.charge?.[0]?.chargeAmount?.amount ?? '0'),
      })),
      placedAt: new Date(o.orderDate),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const signature =
      headers['wm_sec.auth_signature'] ?? headers['WM_SEC.AUTH_SIGNATURE'] ?? '';
    if (!signature) return false;
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const rawTopic = payload.eventType ?? payload.resourceName ?? 'unknown';

    const topicMap: Record<string, string> = {
      OFFER_UNPUBLISHED: 'product.updated',
      PO_CREATED: 'order.created',
      PO_LINE_AUTOCANCELLED: 'order.cancelled',
      INVENTORY_UPDATED: 'inventory.updated',
    };

    return {
      topic: topicMap[rawTopic] ?? rawTopic,
      platformTopic: rawTopic,
      idempotencyKey: payload.eventId ?? crypto.randomUUID(),
      payload: payload.payload ?? payload,
      occurredAt: payload.eventTime ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    const topicMap: Record<string, string> = {
      'order.created': 'PO_CREATED',
      'order.cancelled': 'PO_LINE_AUTOCANCELLED',
      'inventory.updated': 'INVENTORY_UPDATED',
      'product.updated': 'OFFER_UNPUBLISHED',
    };

    await this.walmartFetch('/webhooks', creds.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        eventType: topicMap[topic] ?? topic,
        eventUrl: callbackUrl,
        status: 'ACTIVE',
        authDetails: {
          authMethod: 'HMAC',
        },
      }),
    });
  }

  getRateLimitConfig(): RateLimitConfig {
    // Walmart: 20 requests per second overall, varies by API.
    return { requestsPerSecond: 20, burstLimit: 50 };
  }
}
