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

const TIKTOK_AUTH_URL = 'https://auth.tiktok-shops.com/oauth/authorize';
const TIKTOK_TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get';
const TIKTOK_REFRESH_URL = 'https://auth.tiktok-shops.com/api/v2/token/refresh';
const TIKTOK_API_BASE = 'https://open-api.tiktokglobalshop.com';

@Injectable()
export class TikTokShopAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.tiktok_shop;
  readonly displayName = 'TikTok Shop';
  readonly logoUrl = 'https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/webapp/main/webapp-desktop/47624c235268dba1.png';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(TikTokShopAdapter.name);
  private readonly appKey: string;
  private readonly appSecret: string;

  constructor(private readonly config: ConfigService) {
    this.appKey = this.config.get<string>('TIKTOK_SHOP_APP_KEY', '');
    this.appSecret = this.config.get<string>('TIKTOK_SHOP_APP_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * TikTok Shop Open API requires signing every request.
   * The signature is computed as: HMAC-SHA256(app_secret, path + sorted_params).
   */
  private sign(path: string, params: Record<string, string>, timestamp: number): string {
    const sortedKeys = Object.keys(params).sort();
    let baseString = path;
    for (const key of sortedKeys) {
      baseString += key + params[key];
    }
    return crypto
      .createHmac('sha256', this.appSecret)
      .update(baseString)
      .digest('hex');
  }

  private async tiktokFetch<T = any>(
    accessToken: string,
    path: string,
    queryParams: Record<string, string> = {},
    options: RequestInit = {},
  ): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000);
    const allParams: Record<string, string> = {
      app_key: this.appKey,
      timestamp: String(timestamp),
      access_token: accessToken,
      ...queryParams,
    };
    const sign = this.sign(path, allParams, timestamp);
    allParams.sign = sign;

    const qs = new URLSearchParams(allParams).toString();
    const url = `${TIKTOK_API_BASE}${path}?${qs}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TikTok Shop API ${res.status}: ${text}`);
    }
    const json = (await res.json()) as any;
    if (json.code !== 0 && json.code !== undefined) {
      throw new Error(`TikTok Shop API error ${json.code}: ${json.message}`);
    }
    return json as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    return (
      `${TIKTOK_AUTH_URL}` +
      `?app_key=${encodeURIComponent(this.appKey)}` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const tokenRes = await fetch(
      `${TIKTOK_TOKEN_URL}?app_key=${this.appKey}&app_secret=${this.appSecret}&auth_code=${code}&grant_type=authorized_code`,
    );
    if (!tokenRes.ok) {
      throw new Error(`TikTok Shop token exchange failed: ${await tokenRes.text()}`);
    }
    const result = (await tokenRes.json()) as {
      data: {
        access_token: string;
        refresh_token: string;
        access_token_expire_in: number;
        refresh_token_expire_in: number;
        open_id: string;
        seller_name: string;
      };
    };
    const data = result.data;
    const expiresAt = new Date(Date.now() + data.access_token_expire_in * 1000).toISOString();

    // Fetch shop info
    let shopName = data.seller_name ?? 'TikTok Shop';
    let shopId = data.open_id;
    try {
      const shopRes = await this.tiktokFetch<{
        data: { shops: { id: string; name: string }[] };
      }>(data.access_token, '/api/shop/get_authorized_shop');
      if (shopRes.data?.shops?.length) {
        shopId = shopRes.data.shops[0].id;
        shopName = shopRes.data.shops[0].name;
      }
    } catch (e) {
      this.logger.warn(`Could not fetch TikTok shop info: ${e}`);
    }

    return {
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        openId: data.open_id,
      },
      shopId,
      shopName,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const res = await fetch(
      `${TIKTOK_REFRESH_URL}?app_key=${this.appKey}&app_secret=${this.appSecret}` +
        `&refresh_token=${creds.refreshToken}&grant_type=refresh_token`,
    );
    if (!res.ok) throw new Error(`TikTok Shop refresh failed: ${await res.text()}`);
    const result = (await res.json()) as {
      data: {
        access_token: string;
        refresh_token: string;
        access_token_expire_in: number;
      };
    };
    return {
      ...creds,
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token,
      expiresAt: new Date(Date.now() + result.data.access_token_expire_in * 1000).toISOString(),
    };
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const pageSize = pagination?.limit ?? 20;
    const body: Record<string, unknown> = { page_size: pageSize };
    if (pagination?.cursor) {
      body.cursor = pagination.cursor;
    }

    const res = await this.tiktokFetch<{
      data: { products: any[]; next_cursor: string; total: number };
    }>(creds.accessToken, '/api/products/search', {}, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const products: NormalizedProduct[] = (res.data?.products ?? []).map((p: any) => ({
      platformProductId: String(p.id),
      title: p.name ?? '',
      description: p.description ?? undefined,
      brand: p.brand?.name ?? undefined,
      category: p.category_list?.[0]?.name ?? undefined,
      tags: [],
      images: (p.images ?? []).map((img: any, idx: number) => ({
        url: img.url_list?.[0] ?? img.thumb_url_list?.[0] ?? '',
        platformImageId: String(img.id ?? idx),
        position: idx,
      })),
      variants: (p.skus ?? []).map((sku: any) => ({
        platformVariantId: String(sku.id),
        sku: sku.seller_sku ?? undefined,
        barcode: sku.identifier_code?.identifier_code ?? undefined,
        title: sku.name ?? p.name,
        options: (sku.sales_attributes ?? []).reduce(
          (acc: Record<string, string>, attr: any) => {
            acc[attr.name ?? attr.id] = attr.value_name ?? attr.value_id ?? '';
            return acc;
          },
          {},
        ),
        price: parseFloat(sku.price?.sale_price ?? sku.price?.original_price ?? '0'),
        currency: sku.price?.currency ?? 'USD',
        stockQuantity: sku.stock_infos?.[0]?.available_stock ?? 0,
      })),
      status: p.status === 4 ? 'active' : 'draft',
    }));

    return {
      products,
      nextCursor: res.data?.next_cursor || undefined,
    };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.tiktokFetch<{ data: any }>(
      creds.accessToken,
      `/api/products/details`,
      { product_id: productId },
    );
    return (res.data?.images ?? []).map((img: any, idx: number) => ({
      url: img.url_list?.[0] ?? img.thumb_url_list?.[0] ?? '',
      platformImageId: String(img.id ?? idx),
      position: idx,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;

    const body = {
      product_name: product.title,
      description: product.description ?? '',
      category_id: product.category ?? '',
      brand_id: product.brand ?? '',
      images: (product.images ?? []).map((img) => ({ img_url: img.url })),
      skus: product.variants.map((v) => ({
        seller_sku: v.sku,
        original_price: String(v.price),
        stock_infos: [{ available_stock: v.stockQuantity ?? 0 }],
        identifier_code: v.barcode
          ? { identifier_code: v.barcode, identifier_code_type: 1 }
          : undefined,
        sales_attributes: Object.entries(v.options ?? {}).map(([name, value]) => ({
          attribute_name: name,
          custom_value: value,
        })),
      })),
    };

    const res = await this.tiktokFetch<{
      data: { product_id: string; skus: { id: string }[] };
    }>(creds.accessToken, '/api/products', {}, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      platformProductId: res.data.product_id,
      platformVariantIds: (res.data.skus ?? []).map((s: any) => String(s.id)),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const update: Record<string, unknown> = { product_id: platformProductId };
    if (changes.title !== undefined) update.product_name = changes.title;
    if (changes.description !== undefined) update.description = changes.description;
    if (changes.images !== undefined) {
      update.images = changes.images.map((img) => ({ img_url: img.url }));
    }

    await this.tiktokFetch(
      creds.accessToken,
      '/api/products',
      {},
      { method: 'PUT', body: JSON.stringify(update) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    // Search for the product by seller SKU
    const searchRes = await this.tiktokFetch<{
      data: { products: any[] };
    }>(creds.accessToken, '/api/products/search', {}, {
      method: 'POST',
      body: JSON.stringify({ seller_sku_list: [sku], page_size: 1 }),
    });
    const product = searchRes.data?.products?.[0];
    if (!product) throw new Error(`SKU "${sku}" not found on TikTok Shop`);
    const matchingSku = (product.skus ?? []).find((s: any) => s.seller_sku === sku);
    return matchingSku?.stock_infos?.[0]?.available_stock ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    // Find the product + sku id
    const searchRes = await this.tiktokFetch<{
      data: { products: any[] };
    }>(creds.accessToken, '/api/products/search', {}, {
      method: 'POST',
      body: JSON.stringify({ seller_sku_list: [sku], page_size: 1 }),
    });
    const product = searchRes.data?.products?.[0];
    if (!product) throw new Error(`SKU "${sku}" not found on TikTok Shop`);
    const matchingSku = (product.skus ?? []).find((s: any) => s.seller_sku === sku);
    if (!matchingSku) throw new Error(`SKU "${sku}" variant not found on TikTok Shop`);

    await this.tiktokFetch(
      creds.accessToken,
      '/api/products/stocks',
      {},
      {
        method: 'PUT',
        body: JSON.stringify({
          product_id: String(product.id),
          skus: [
            {
              id: String(matchingSku.id),
              stock_infos: [{ available_stock: quantity }],
            },
          ],
        }),
      },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const createTimeFrom = Math.floor(since.getTime() / 1000);
    const createTimeTo = Math.floor(Date.now() / 1000);

    const res = await this.tiktokFetch<{
      data: { order_list: any[]; next_cursor: string };
    }>(creds.accessToken, '/api/orders/search', {}, {
      method: 'POST',
      body: JSON.stringify({
        create_time_from: createTimeFrom,
        create_time_to: createTimeTo,
        page_size: 50,
      }),
    });

    return (res.data?.order_list ?? []).map((o: any) => ({
      platformOrderId: String(o.order_id),
      status: o.order_status_text ?? String(o.order_status ?? 'unknown'),
      currency: o.payment?.currency ?? 'USD',
      subtotal: parseFloat(o.payment?.sub_total ?? '0'),
      taxTotal: parseFloat(o.payment?.tax ?? '0'),
      shippingTotal: parseFloat(o.payment?.shipping_fee ?? '0'),
      grandTotal: parseFloat(o.payment?.total_amount ?? '0'),
      customer: o.buyer_info
        ? {
            email: o.buyer_info.buyer_email,
            firstName: o.buyer_info.buyer_first_name,
            lastName: o.buyer_info.buyer_last_name,
            phone: o.buyer_info.buyer_phone,
          }
        : undefined,
      shippingAddress: o.recipient_address
        ? {
            name: o.recipient_address.name,
            addressLine1: o.recipient_address.address_line1,
            addressLine2: o.recipient_address.address_line2,
            city: o.recipient_address.city,
            province: o.recipient_address.state,
            postalCode: o.recipient_address.zipcode,
            country: o.recipient_address.region_code,
            phone: o.recipient_address.phone,
          }
        : undefined,
      items: (o.item_list ?? []).map((li: any) => ({
        platformLineItemId: String(li.item_id),
        sku: li.seller_sku ?? undefined,
        title: li.product_name,
        quantity: li.quantity ?? 1,
        unitPrice: parseFloat(li.sale_price ?? '0'),
        totalPrice: parseFloat(li.sale_price ?? '0') * (li.quantity ?? 1),
      })),
      placedAt: new Date((o.create_time ?? 0) * 1000),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const signature =
      headers['authorization'] ?? headers['Authorization'] ?? '';
    const bodyStr = typeof body === 'string' ? body : body.toString('utf-8');
    const digest = crypto
      .createHmac('sha256', secret)
      .update(bodyStr)
      .digest('hex');
    return signature === digest;
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const rawType = String(payload.type ?? 'unknown');

    const topicMap: Record<string, string> = {
      '1': 'order.created',
      '2': 'order.cancelled',
      '3': 'product.updated',
      '4': 'inventory.updated',
      PRODUCT_STATUS_CHANGE: 'product.updated',
      ORDER_STATUS_CHANGE: 'order.updated',
      STOCK_CHANGED: 'inventory.updated',
    };

    return {
      topic: topicMap[rawType] ?? rawType,
      platformTopic: rawType,
      idempotencyKey: payload.shop_id
        ? `${payload.shop_id}-${payload.timestamp ?? Date.now()}`
        : crypto.randomUUID(),
      payload: payload.data ?? payload,
      occurredAt: payload.timestamp
        ? new Date(payload.timestamp * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    // TikTok Shop webhook registration is done via the app settings page
    // in the TikTok Shop Partner Center. This API call sets the URL programmatically.
    await this.tiktokFetch(
      creds.accessToken,
      '/api/event/webhook/update',
      {},
      {
        method: 'PUT',
        body: JSON.stringify({
          url: callbackUrl,
          event_type: topic,
        }),
      },
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    return { requestsPerSecond: 10, burstLimit: 100 };
  }
}
