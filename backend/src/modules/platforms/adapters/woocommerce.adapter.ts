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

@Injectable()
export class WooCommerceAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.woocommerce;
  readonly displayName = 'WooCommerce';
  readonly logoUrl = 'https://woocommerce.com/wp-content/themes/flavor/images/logos/woocommerce-logo-color.svg';
  readonly authType: AuthType = 'basic';

  private readonly logger = new Logger(WooCommerceAdapter.name);

  constructor(private readonly config: ConfigService) {}

  // ── Helpers ─────────────────────────────────────────────────────────────

  private baseUrl(storeUrl: string): string {
    const base = storeUrl.replace(/\/+$/, '');
    return `${base}/wp-json/wc/v3`;
  }

  private basicAuth(consumerKey: string, consumerSecret: string): string {
    return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;
  }

  private async wooFetch<T = any>(
    storeUrl: string,
    consumerKey: string,
    consumerSecret: string,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl(storeUrl)}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.basicAuth(consumerKey, consumerSecret),
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WooCommerce API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    // WooCommerce uses the REST API Keys approach. The "auth URL" sends the
    // user to their own store to create API credentials which POST back.
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    // {storeUrl} is a placeholder the frontend replaces with the user's store URL.
    return (
      `{storeUrl}/wc-auth/v1/authorize` +
      `?app_name=Linker+Pro` +
      `&scope=read_write` +
      `&user_id=${tenantId}` +
      `&return_url=${encodeURIComponent(redirectUri)}` +
      `&callback_url=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    // WooCommerce callback delivers consumer_key and consumer_secret directly
    // (they come as JSON POST body, code here represents that JSON string).
    const data = JSON.parse(code) as {
      consumer_key: string;
      consumer_secret: string;
      key_permissions: string;
      store_url?: string;
    };
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    const storeUrl = data.store_url ?? parsed.storeUrl ?? '';

    // Fetch store info
    const sysInfo = await this.wooFetch<{
      store_id: number;
      description: string;
    }>(storeUrl, data.consumer_key, data.consumer_secret, '/system_status');

    return {
      credentials: {
        apiKey: data.consumer_key,
        apiSecret: data.consumer_secret,
        storeUrl,
      },
      shopId: String(sysInfo.store_id ?? storeUrl),
      shopName: sysInfo.description ?? storeUrl,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    // WooCommerce consumer keys do not expire.
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

    const data = await this.wooFetch<any[]>(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/products?page=${page}&per_page=${limit}`,
    );

    const products: NormalizedProduct[] = data.map((p: any) => ({
      platformProductId: String(p.id),
      title: p.name,
      description: p.description ?? p.short_description ?? undefined,
      brand: p.brands?.[0]?.name ?? undefined,
      category: p.categories?.[0]?.name ?? undefined,
      tags: (p.tags ?? []).map((t: any) => t.name),
      images: (p.images ?? []).map((img: any, idx: number) => ({
        url: img.src,
        platformImageId: String(img.id),
        position: idx,
        altText: img.alt ?? undefined,
      })),
      variants:
        p.variations?.length > 0
          ? [] // variations must be fetched separately
          : [
              {
                platformVariantId: String(p.id),
                sku: p.sku ?? undefined,
                barcode: p.meta_data?.find((m: any) => m.key === '_barcode')?.value ?? undefined,
                title: p.name,
                options: {},
                price: parseFloat(p.price ?? p.regular_price ?? '0'),
                currency: 'USD',
                compareAtPrice: p.regular_price && p.sale_price
                  ? parseFloat(p.regular_price)
                  : undefined,
                weightGrams: p.weight ? parseFloat(p.weight) * 1000 : undefined,
                stockQuantity: p.stock_quantity ?? 0,
              },
            ],
      status: p.status === 'publish' ? 'active' : p.status === 'trash' ? 'archived' : 'draft',
      platformUrl: p.permalink ?? undefined,
    }));

    // If we got a full page, there may be more
    const nextCursor = data.length >= limit ? String(page + 1) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const product = await this.wooFetch<any>(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/products/${productId}`,
    );
    return (product.images ?? []).map((img: any, idx: number) => ({
      url: img.src,
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
    const isSimple = product.variants.length <= 1;

    const body: Record<string, unknown> = {
      name: product.title,
      type: isSimple ? 'simple' : 'variable',
      description: product.description ?? '',
      tags: (product.tags ?? []).map((t) => ({ name: t })),
      images: (product.images ?? []).map((img) => ({
        src: img.url,
        alt: img.altText ?? '',
      })),
    };

    if (isSimple && product.variants[0]) {
      const v = product.variants[0];
      body.sku = v.sku;
      body.regular_price = String(v.price);
      body.manage_stock = true;
      body.stock_quantity = v.stockQuantity ?? 0;
      if (v.weightGrams) body.weight = String(v.weightGrams / 1000);
    }

    const created = await this.wooFetch<any>(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      '/products',
      { method: 'POST', body: JSON.stringify(body) },
    );

    const variantIds: string[] = [String(created.id)];

    // Create variations for variable products
    if (!isSimple) {
      for (const v of product.variants) {
        const varBody = {
          sku: v.sku,
          regular_price: String(v.price),
          manage_stock: true,
          stock_quantity: v.stockQuantity ?? 0,
          attributes: Object.entries(v.options ?? {}).map(([name, option]) => ({
            name,
            option,
          })),
        };
        const variation = await this.wooFetch<any>(
          creds.storeUrl,
          creds.apiKey,
          creds.apiSecret,
          `/products/${created.id}/variations`,
          { method: 'POST', body: JSON.stringify(varBody) },
        );
        variantIds.push(String(variation.id));
      }
    }

    return {
      platformProductId: String(created.id),
      platformVariantIds: variantIds,
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
    if (changes.price !== undefined) update.regular_price = String(changes.price);
    if (changes.status !== undefined) {
      update.status = changes.status === 'active' ? 'publish' : 'draft';
    }
    if (changes.tags !== undefined) {
      update.tags = changes.tags.map((t) => ({ name: t }));
    }
    if (changes.images !== undefined) {
      update.images = changes.images.map((img) => ({
        src: img.url,
        alt: img.altText ?? '',
      }));
    }

    await this.wooFetch(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/products/${platformProductId}`,
      { method: 'PUT', body: JSON.stringify(update) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const products = await this.wooFetch<any[]>(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/products?sku=${encodeURIComponent(sku)}&per_page=1`,
    );
    if (!products.length) throw new Error(`SKU "${sku}" not found on WooCommerce`);
    return products[0].stock_quantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    const products = await this.wooFetch<any[]>(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/products?sku=${encodeURIComponent(sku)}&per_page=1`,
    );
    if (!products.length) throw new Error(`SKU "${sku}" not found on WooCommerce`);

    await this.wooFetch(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/products/${products[0].id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ stock_quantity: quantity, manage_stock: true }),
      },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const data = await this.wooFetch<any[]>(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      `/orders?after=${since.toISOString()}&per_page=100&orderby=date&order=desc`,
    );

    return data.map((o: any) => ({
      platformOrderId: String(o.id),
      status: o.status ?? 'unknown',
      currency: o.currency ?? 'USD',
      subtotal: parseFloat(o.total ?? '0') - parseFloat(o.total_tax ?? '0') - parseFloat(o.shipping_total ?? '0'),
      taxTotal: parseFloat(o.total_tax ?? '0'),
      shippingTotal: parseFloat(o.shipping_total ?? '0'),
      grandTotal: parseFloat(o.total ?? '0'),
      customer: o.billing
        ? {
            email: o.billing.email,
            firstName: o.billing.first_name,
            lastName: o.billing.last_name,
            phone: o.billing.phone,
          }
        : undefined,
      shippingAddress: o.shipping
        ? {
            name: `${o.shipping.first_name ?? ''} ${o.shipping.last_name ?? ''}`.trim(),
            company: o.shipping.company,
            addressLine1: o.shipping.address_1,
            addressLine2: o.shipping.address_2,
            city: o.shipping.city,
            province: o.shipping.state,
            postalCode: o.shipping.postcode,
            country: o.shipping.country,
            phone: o.shipping.phone,
          }
        : undefined,
      items: (o.line_items ?? []).map((li: any) => ({
        platformLineItemId: String(li.id),
        sku: li.sku ?? undefined,
        title: li.name,
        quantity: li.quantity,
        unitPrice: parseFloat(li.price ?? '0'),
        totalPrice: parseFloat(li.total ?? '0'),
      })),
      placedAt: new Date(o.date_created_gmt ?? o.date_created),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const signature =
      headers['x-wc-webhook-signature'] ?? headers['X-WC-Webhook-Signature'] ?? '';
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('base64');
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
    const resource =
      headers['x-wc-webhook-resource'] ?? headers['X-WC-Webhook-Resource'] ?? '';
    const wcEvent =
      headers['x-wc-webhook-event'] ?? headers['X-WC-Webhook-Event'] ?? '';
    const rawTopic = `${resource}.${wcEvent}`;
    const deliveryId =
      headers['x-wc-webhook-delivery-id'] ??
      headers['X-WC-Webhook-Delivery-Id'] ??
      headers['x-wc-webhook-id'] ??
      crypto.randomUUID();

    const topicMap: Record<string, string> = {
      'product.created': 'product.created',
      'product.updated': 'product.updated',
      'product.deleted': 'product.deleted',
      'order.created': 'order.created',
      'order.updated': 'order.updated',
      'order.cancelled': 'order.cancelled',
    };

    return {
      topic: topicMap[rawTopic] ?? rawTopic,
      platformTopic: rawTopic,
      idempotencyKey: deliveryId,
      payload,
      occurredAt: payload.date_modified_gmt ?? payload.date_created_gmt ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    // WooCommerce uses "resource.event" format: product.created, order.updated, etc.
    const topicMap: Record<string, string> = {
      'product.created': 'product.created',
      'product.updated': 'product.updated',
      'product.deleted': 'product.deleted',
      'order.created': 'order.created',
      'order.updated': 'order.updated',
      'order.cancelled': 'order.updated',
      'inventory.updated': 'product.updated',
    };

    const wcTopic = topicMap[topic] ?? topic;

    await this.wooFetch(
      creds.storeUrl,
      creds.apiKey,
      creds.apiSecret,
      '/webhooks',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `Linker Pro - ${topic}`,
          topic: wcTopic,
          delivery_url: callbackUrl,
          status: 'active',
        }),
      },
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    // WooCommerce rate limits depend on hosting, these are conservative defaults.
    return { requestsPerSecond: 5, burstLimit: 25 };
  }
}
