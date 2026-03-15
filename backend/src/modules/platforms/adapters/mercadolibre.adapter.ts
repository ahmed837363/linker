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

const MELI_AUTH_URL = 'https://auth.mercadolibre.com/authorization';
const MELI_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const MELI_API_BASE = 'https://api.mercadolibre.com';

@Injectable()
export class MercadoLibreAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.mercadolibre;
  readonly displayName = 'MercadoLibre';
  readonly logoUrl = 'https://http2.mlstatic.com/frontend-assets/ui-navigation/5.21.4/mercadolibre/logo__large_plus.png';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(MercadoLibreAdapter.name);
  private readonly appId: string;
  private readonly clientSecret: string;

  constructor(private readonly config: ConfigService) {
    this.appId = this.config.get<string>('MELI_APP_ID', '');
    this.clientSecret = this.config.get<string>('MELI_CLIENT_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async meliFetch<T = any>(
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${MELI_API_BASE}${path}`;
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
      throw new Error(`MercadoLibre API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    return (
      `${MELI_AUTH_URL}` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(this.appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());

    const tokenRes = await fetch(MELI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.appId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: '', // Must match the registered redirect URI
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`MercadoLibre token exchange failed: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user_id: number;
      token_type: string;
    };
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // Fetch user details
    const user = await this.meliFetch<{
      id: number;
      nickname: string;
      site_id: string;
    }>('/users/me', token.access_token);

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        tokenType: token.token_type,
        userId: String(token.user_id),
        siteId: user.site_id,
      },
      shopId: String(token.user_id),
      shopName: user.nickname ?? `MeLi Seller ${token.user_id}`,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const tokenRes = await fetch(MELI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.appId,
        client_secret: this.clientSecret,
        refresh_token: creds.refreshToken,
      }),
    });
    if (!tokenRes.ok) throw new Error(`MercadoLibre refresh failed: ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      ...creds,
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
    const userId = creds.userId;
    const limit = pagination?.limit ?? 50;
    const offset = pagination?.cursor ? parseInt(pagination.cursor, 10) : 0;

    // Search seller's items
    const searchRes = await this.meliFetch<{
      results: string[];
      paging: { total: number; offset: number; limit: number };
    }>(
      `/users/${userId}/items/search?offset=${offset}&limit=${limit}`,
      creds.accessToken,
    );

    if (!searchRes.results?.length) {
      return { products: [], nextCursor: undefined };
    }

    // Fetch item details in bulk (max 20 at a time)
    const ids = searchRes.results.slice(0, 20).join(',');
    const items = await this.meliFetch<any[]>(
      `/items?ids=${ids}`,
      creds.accessToken,
    );

    const products: NormalizedProduct[] = (items ?? []).map((wrapper: any) => {
      const item = wrapper.body ?? wrapper;
      return {
        platformProductId: item.id,
        title: item.title ?? '',
        description: undefined, // Description is a separate endpoint
        brand:
          item.attributes?.find((a: any) => a.id === 'BRAND')?.value_name ?? undefined,
        category: item.category_id ?? undefined,
        tags: item.tags ?? [],
        images: (item.pictures ?? []).map((pic: any, idx: number) => ({
          url: pic.secure_url ?? pic.url,
          platformImageId: pic.id,
          position: idx,
        })),
        variants: (item.variations ?? [item]).map((v: any) => ({
          platformVariantId: String(v.id ?? item.id),
          sku: v.seller_custom_field ?? item.seller_custom_field ?? undefined,
          barcode:
            v.attributes?.find((a: any) => a.id === 'GTIN')?.value_name ?? undefined,
          title: v.attribute_combinations
            ? v.attribute_combinations.map((a: any) => a.value_name).join(' / ')
            : item.title,
          options: (v.attribute_combinations ?? []).reduce(
            (acc: Record<string, string>, a: any) => {
              acc[a.name ?? a.id] = a.value_name ?? '';
              return acc;
            },
            {},
          ),
          price: item.price ?? 0,
          currency: item.currency_id ?? 'USD',
          stockQuantity: v.available_quantity ?? item.available_quantity ?? 0,
        })),
        status: item.status === 'active' ? 'active' : item.status === 'closed' ? 'archived' : 'draft',
        platformUrl: item.permalink ?? undefined,
      };
    });

    const nextOffset = offset + limit;
    const nextCursor =
      nextOffset < (searchRes.paging?.total ?? 0) ? String(nextOffset) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const item = await this.meliFetch<any>(
      `/items/${productId}`,
      creds.accessToken,
    );
    return (item.pictures ?? []).map((pic: any, idx: number) => ({
      url: pic.secure_url ?? pic.url,
      platformImageId: pic.id,
      position: idx,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const variant = product.variants[0];
    const siteId = creds.siteId ?? 'MLA'; // Default to Argentina

    const body: Record<string, unknown> = {
      title: product.title,
      category_id: product.category ?? `${siteId}1234`, // Must be a valid MELI category
      price: variant?.price ?? 0,
      currency_id: variant?.currency ?? 'USD',
      available_quantity: variant?.stockQuantity ?? 1,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      description: { plain_text: product.description ?? '' },
      pictures: (product.images ?? []).map((img) => ({ source: img.url })),
      seller_custom_field: variant?.sku,
    };

    if (product.variants.length > 1) {
      body.variations = product.variants.map((v) => ({
        price: v.price,
        available_quantity: v.stockQuantity ?? 1,
        seller_custom_field: v.sku,
        attribute_combinations: Object.entries(v.options ?? {}).map(
          ([name, value]) => ({ name, value_name: value }),
        ),
        picture_ids: [], // Would reference uploaded pictures
      }));
    }

    const res = await this.meliFetch<{ id: string; variations: { id: number }[] }>(
      '/items',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return {
      platformProductId: res.id,
      platformVariantIds: (res.variations ?? []).map((v: any) => String(v.id)),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const update: Record<string, unknown> = {};
    if (changes.title !== undefined) update.title = changes.title;
    if (changes.price !== undefined) update.price = changes.price;
    if (changes.status !== undefined) {
      update.status = changes.status === 'active' ? 'active' : 'paused';
    }
    if (changes.images !== undefined) {
      update.pictures = changes.images.map((img) => ({ source: img.url }));
    }

    await this.meliFetch(
      `/items/${platformProductId}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify(update) },
    );

    // Description is updated separately
    if (changes.description !== undefined) {
      await this.meliFetch(
        `/items/${platformProductId}/description`,
        creds.accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({ plain_text: changes.description }),
        },
      );
    }
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const userId = creds.userId;
    // Search items by seller_custom_field (SKU)
    const searchRes = await this.meliFetch<{
      results: string[];
    }>(
      `/users/${userId}/items/search?seller_custom_field=${encodeURIComponent(sku)}&limit=1`,
      creds.accessToken,
    );
    if (!searchRes.results?.length) throw new Error(`SKU "${sku}" not found on MercadoLibre`);
    const item = await this.meliFetch<any>(
      `/items/${searchRes.results[0]}`,
      creds.accessToken,
    );
    return item.available_quantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    const userId = creds.userId;
    const searchRes = await this.meliFetch<{ results: string[] }>(
      `/users/${userId}/items/search?seller_custom_field=${encodeURIComponent(sku)}&limit=1`,
      creds.accessToken,
    );
    if (!searchRes.results?.length) throw new Error(`SKU "${sku}" not found on MercadoLibre`);

    await this.meliFetch(
      `/items/${searchRes.results[0]}`,
      creds.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ available_quantity: quantity }),
      },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const userId = creds.userId;
    const dateFrom = since.toISOString();

    const res = await this.meliFetch<{
      results: any[];
      paging: { total: number };
    }>(
      `/orders/search?seller=${userId}&order.date_created.from=${encodeURIComponent(dateFrom)}&limit=50&sort=date_desc`,
      creds.accessToken,
    );

    return (res.results ?? []).map((o: any) => ({
      platformOrderId: String(o.id),
      status: o.status ?? 'unknown',
      currency: o.currency_id ?? 'USD',
      subtotal: o.total_amount ?? 0,
      taxTotal: o.taxes?.amount ?? 0,
      shippingTotal: o.shipping?.cost ?? 0,
      grandTotal: o.paid_amount ?? o.total_amount ?? 0,
      customer: o.buyer
        ? {
            email: o.buyer.email,
            firstName: o.buyer.first_name,
            lastName: o.buyer.last_name,
            phone: o.buyer.phone?.number,
          }
        : undefined,
      shippingAddress: o.shipping?.receiver_address
        ? {
            name: o.shipping.receiver_address.receiver_name,
            addressLine1: o.shipping.receiver_address.street_name,
            addressLine2: o.shipping.receiver_address.comment,
            city: o.shipping.receiver_address.city?.name,
            province: o.shipping.receiver_address.state?.name,
            postalCode: o.shipping.receiver_address.zip_code,
            country: o.shipping.receiver_address.country?.id,
            phone: o.shipping.receiver_address.receiver_phone,
          }
        : undefined,
      items: (o.order_items ?? []).map((li: any) => ({
        platformLineItemId: String(li.item?.id),
        sku: li.item?.seller_custom_field ?? undefined,
        title: li.item?.title,
        quantity: li.quantity ?? 1,
        unitPrice: li.unit_price ?? 0,
        totalPrice: (li.unit_price ?? 0) * (li.quantity ?? 1),
      })),
      placedAt: new Date(o.date_created),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    // MercadoLibre sends a signature in the x-signature header.
    const signature =
      headers['x-signature'] ?? headers['X-Signature'] ?? '';
    if (!signature) return false;
    // Extract ts and v1 from the signature header: ts=...,v1=...
    const parts: Record<string, string> = {};
    for (const part of signature.split(',')) {
      const [key, val] = part.split('=');
      if (key && val) parts[key.trim()] = val.trim();
    }
    const ts = parts['ts'] ?? '';
    const v1 = parts['v1'] ?? '';

    // Compute expected signature: HMAC-SHA256(secret, id:path:ts:body)
    // For webhook notifications the template is: ts + "." + body
    const digest = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.${typeof body === 'string' ? body : body.toString('utf-8')}`)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(v1));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const rawTopic = payload.topic ?? 'unknown';

    const topicMap: Record<string, string> = {
      items: 'product.updated',
      orders_v2: 'order.updated',
      questions: 'product.updated',
      shipments: 'order.updated',
    };

    return {
      topic: topicMap[rawTopic] ?? rawTopic,
      platformTopic: rawTopic,
      idempotencyKey: payload._id ?? payload.id ?? crypto.randomUUID(),
      payload,
      occurredAt: payload.received ?? payload.sent ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    const topicMap: Record<string, string> = {
      'product.updated': 'items',
      'product.created': 'items',
      'order.created': 'orders_v2',
      'order.updated': 'orders_v2',
    };

    await this.meliFetch('/applications/' + this.appId + '/webhooks', creds.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        topic: topicMap[topic] ?? topic,
        callback_url: callbackUrl,
      }),
    });
  }

  getRateLimitConfig(): RateLimitConfig {
    // MercadoLibre: varies by endpoint; general limit is around 10k/hour
    return { requestsPerSecond: 3, burstLimit: 30 };
  }
}
