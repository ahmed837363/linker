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

const AE_AUTH_URL = 'https://api-sg.aliexpress.com/oauth/authorize';
const AE_TOKEN_URL = 'https://api-sg.aliexpress.com/auth/token/create';
const AE_REFRESH_URL = 'https://api-sg.aliexpress.com/auth/token/refresh';
const AE_API_GATEWAY = 'https://api-sg.aliexpress.com/sync';

@Injectable()
export class AliExpressAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.aliexpress;
  readonly displayName = 'AliExpress';
  readonly logoUrl = 'https://ae01.alicdn.com/kf/S1042cf1e1ff04ef8b23e87d7e8ae5c9cC/200x200.png';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(AliExpressAdapter.name);
  private readonly appKey: string;
  private readonly appSecret: string;

  constructor(private readonly config: ConfigService) {
    this.appKey = this.config.get<string>('ALIEXPRESS_APP_KEY', '');
    this.appSecret = this.config.get<string>('ALIEXPRESS_APP_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * AliExpress Open Platform API requires signing requests.
   * Signature = uppercase(HEX(HMAC-SHA256(appSecret, sorted_param_string))).
   */
  private signParams(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const baseString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
    return crypto
      .createHmac('sha256', this.appSecret)
      .update(baseString)
      .digest('hex')
      .toUpperCase();
  }

  private async aeFetch<T = any>(
    method: string,
    accessToken: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const systemParams: Record<string, string> = {
      app_key: this.appKey,
      method,
      timestamp,
      sign_method: 'hmac-sha256',
      v: '2.0',
      format: 'json',
      session: accessToken,
    };

    // Flatten business params for signing
    const allParamsForSign: Record<string, string> = { ...systemParams };
    for (const [k, v] of Object.entries(params)) {
      allParamsForSign[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    const sign = this.signParams(allParamsForSign);
    allParamsForSign.sign = sign;

    const qs = new URLSearchParams(allParamsForSign).toString();
    const url = `${AE_API_GATEWAY}?${qs}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AliExpress API ${res.status}: ${text}`);
    }
    const json = (await res.json()) as any;
    if (json.error_response) {
      throw new Error(
        `AliExpress API error ${json.error_response.code}: ${json.error_response.msg}`,
      );
    }
    return json as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    return (
      `${AE_AUTH_URL}` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(this.appKey)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&sp=ae`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const tokenRes = await fetch(AE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        app_key: this.appKey,
        app_secret: this.appSecret,
        code,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`AliExpress token exchange failed: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expire_time: number; // timestamp millis
      refresh_token_valid_time: number;
      user_nick: string;
      user_id: string;
      seller_id?: string;
      sp?: string;
    };

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expire_time).toISOString(),
        userId: token.user_id,
        sellerId: token.seller_id ?? token.user_id,
      },
      shopId: token.seller_id ?? token.user_id,
      shopName: token.user_nick ?? `AliExpress Seller ${token.user_id}`,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const tokenRes = await fetch(AE_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        app_key: this.appKey,
        app_secret: this.appSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!tokenRes.ok) throw new Error(`AliExpress refresh failed: ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expire_time: number;
    };
    return {
      ...creds,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(token.expire_time).toISOString(),
    };
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.limit ?? 20;

    const res = await this.aeFetch<any>(
      'aliexpress.solution.product.list.get',
      creds.accessToken,
      {
        current_page: String(page),
        page_size: String(pageSize),
      },
    );

    const responseKey = Object.keys(res).find((k) => k.includes('response')) ?? '';
    const data = res[responseKey] ?? {};
    const productList = data.products?.product ?? data.result?.products ?? [];

    const products: NormalizedProduct[] = productList.map((p: any) => ({
      platformProductId: String(p.product_id),
      title: p.subject ?? '',
      description: p.detail ?? undefined,
      brand: p.brand_name ?? undefined,
      category: p.category_id ? String(p.category_id) : undefined,
      tags: [],
      images: (p.image_u_r_ls ? p.image_u_r_ls.split(';') : []).map(
        (url: string, idx: number) => ({ url, position: idx }),
      ),
      variants: (p.aeop_ae_product_s_k_us?.aeop_ae_product_sku ?? []).map((sku: any) => ({
        platformVariantId: sku.id ?? sku.sku_attr ?? String(p.product_id),
        sku: sku.sku_code ?? undefined,
        barcode: sku.barcode ?? undefined,
        title: sku.sku_attr ?? p.subject,
        options: {},
        price: parseFloat(sku.sku_price ?? sku.offer_sale_price ?? '0'),
        currency: sku.currency_code ?? 'USD',
        stockQuantity: sku.ipm_sku_stock ?? sku.s_k_u_available_stock ?? 0,
      })),
      status: p.product_status_type === 'onSelling' ? 'active' : 'draft',
    }));

    const totalPage = data.total_page ?? 1;
    const nextCursor = page < totalPage ? String(page + 1) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.aeFetch<any>(
      'aliexpress.solution.product.info.get',
      creds.accessToken,
      { product_id: productId },
    );
    const responseKey = Object.keys(res).find((k) => k.includes('response')) ?? '';
    const product = res[responseKey]?.result ?? {};
    const urls: string = product.image_u_r_ls ?? '';
    return urls.split(';').filter(Boolean).map((url: string, idx: number) => ({
      url,
      position: idx,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;

    const skus = product.variants.map((v) => ({
      sku_code: v.sku,
      sku_price: String(v.price),
      sku_stock: true,
      ipm_sku_stock: v.stockQuantity ?? 0,
      barcode: v.barcode ?? '',
      sku_attributes_list: Object.entries(v.options ?? {}).map(
        ([name, value]) => ({ sku_attribute_name: name, sku_attribute_value: value }),
      ),
    }));

    const body = {
      category_id: product.category ?? '0',
      subject: product.title,
      description: product.description ?? '',
      image_u_r_ls: (product.images ?? []).map((img) => img.url).join(';'),
      aeop_ae_product_s_k_us: JSON.stringify(skus),
      product_unit: 100000000, // pieces
      delivery_time: 7,
    };

    const res = await this.aeFetch<any>(
      'aliexpress.solution.product.post',
      creds.accessToken,
      body,
    );

    const responseKey = Object.keys(res).find((k) => k.includes('response')) ?? '';
    const productId = res[responseKey]?.result?.product_id ?? 'unknown';

    return {
      platformProductId: String(productId),
      platformVariantIds: product.variants.map((v) => v.sku),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const params: Record<string, unknown> = { product_id: platformProductId };
    if (changes.title !== undefined) params.subject = changes.title;
    if (changes.description !== undefined) params.description = changes.description;
    if (changes.images !== undefined) {
      params.image_u_r_ls = changes.images.map((img) => img.url).join(';');
    }

    await this.aeFetch(
      'aliexpress.solution.product.edit',
      creds.accessToken,
      params,
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    // AliExpress does not have a direct SKU-level stock lookup;
    // we need to find the product first, then look at its SKU stock.
    const res = await this.aeFetch<any>(
      'aliexpress.solution.product.list.get',
      creds.accessToken,
      { current_page: '1', page_size: '50' },
    );
    const responseKey = Object.keys(res).find((k) => k.includes('response')) ?? '';
    const products = res[responseKey]?.products?.product ?? [];

    for (const p of products) {
      const skuList = p.aeop_ae_product_s_k_us?.aeop_ae_product_sku ?? [];
      const match = skuList.find((s: any) => s.sku_code === sku);
      if (match) return match.ipm_sku_stock ?? 0;
    }
    throw new Error(`SKU "${sku}" not found on AliExpress`);
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    // Find the product and update its SKU stock
    const res = await this.aeFetch<any>(
      'aliexpress.solution.product.list.get',
      creds.accessToken,
      { current_page: '1', page_size: '50' },
    );
    const responseKey = Object.keys(res).find((k) => k.includes('response')) ?? '';
    const products = res[responseKey]?.products?.product ?? [];

    let productId: string | undefined;
    for (const p of products) {
      const skuList = p.aeop_ae_product_s_k_us?.aeop_ae_product_sku ?? [];
      const match = skuList.find((s: any) => s.sku_code === sku);
      if (match) {
        productId = String(p.product_id);
        match.ipm_sku_stock = quantity;
        // Update the entire SKU list
        await this.aeFetch(
          'aliexpress.solution.product.edit',
          creds.accessToken,
          {
            product_id: productId,
            aeop_ae_product_s_k_us: JSON.stringify(skuList),
          },
        );
        return;
      }
    }
    throw new Error(`SKU "${sku}" not found on AliExpress`);
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const createDateStart = since.toISOString().replace('T', ' ').split('.')[0];

    const res = await this.aeFetch<any>(
      'aliexpress.solution.order.get',
      creds.accessToken,
      {
        create_date_start: createDateStart,
        order_status: 'PLACE_ORDER_SUCCESS',
        page: '1',
        page_size: '50',
      },
    );

    const responseKey = Object.keys(res).find((k) => k.includes('response')) ?? '';
    const orders = res[responseKey]?.result?.target_list?.order_dto ?? [];

    return orders.map((o: any) => ({
      platformOrderId: String(o.order_id),
      status: o.order_status ?? 'unknown',
      currency: o.init_oder_amount?.currency_code ?? 'USD',
      subtotal: parseFloat(o.init_oder_amount?.amount ?? '0'),
      taxTotal: 0,
      shippingTotal: parseFloat(o.logistics_amount?.amount ?? '0'),
      grandTotal: parseFloat(o.order_amount?.amount ?? o.init_oder_amount?.amount ?? '0'),
      customer: {
        firstName: o.buyer_info?.buyer_login_id,
      },
      shippingAddress: o.receipt_address
        ? {
            name: o.receipt_address.contact_person,
            addressLine1: o.receipt_address.detail_address,
            city: o.receipt_address.city,
            province: o.receipt_address.province,
            postalCode: o.receipt_address.zip,
            country: o.receipt_address.country,
            phone: o.receipt_address.phone_country
              ? `+${o.receipt_address.phone_country}${o.receipt_address.mobile_no}`
              : o.receipt_address.mobile_no,
          }
        : undefined,
      items: (o.product_list?.order_product_dto ?? []).map((li: any) => ({
        platformLineItemId: String(li.order_id ?? o.order_id),
        sku: li.sku_code ?? undefined,
        title: li.product_name,
        quantity: li.product_count ?? 1,
        unitPrice: parseFloat(li.product_unit_price?.amount ?? '0'),
        totalPrice:
          parseFloat(li.product_unit_price?.amount ?? '0') * (li.product_count ?? 1),
      })),
      placedAt: new Date(o.gmt_create),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const signature =
      headers['x-aliexpress-signature'] ?? headers['X-AliExpress-Signature'] ?? '';
    if (!signature) return false;
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('hex')
      .toUpperCase();
    try {
      return crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(signature.toUpperCase()),
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
    const rawType = payload.type ?? payload.event_type ?? 'unknown';

    const topicMap: Record<string, string> = {
      ORDER_PLACE: 'order.created',
      ORDER_CANCEL: 'order.cancelled',
      ORDER_PAY_SUCCESS: 'order.updated',
      PRODUCT_AUDIT_PASS: 'product.updated',
      PRODUCT_OFFLINE: 'product.updated',
      INVENTORY_CHANGE: 'inventory.updated',
    };

    return {
      topic: topicMap[rawType] ?? rawType,
      platformTopic: rawType,
      idempotencyKey: payload.notify_id ?? payload.message_id ?? crypto.randomUUID(),
      payload: payload.data ?? payload,
      occurredAt: payload.notify_time ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    _callbackUrl: string,
  ): Promise<void> {
    // AliExpress webhook / message subscription is configured in the developer
    // console. Programmatic registration is not directly supported via the
    // Open Platform API.
    this.logger.warn(
      `AliExpress webhook registration for "${topic}" must be configured in the AliExpress developer console.`,
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    // AliExpress: 40 QPS per app key
    return { requestsPerSecond: 40, burstLimit: 100 };
  }
}
