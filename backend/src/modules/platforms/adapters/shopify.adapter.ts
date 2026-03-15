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

const API_VERSION = '2024-01';

@Injectable()
export class ShopifyAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.shopify;
  readonly displayName = 'Shopify';
  readonly logoUrl = 'https://cdn.shopify.com/shopifycloud/brochure/assets/brand-assets/shopify-logo-primary-logo-456baa801ee66a0a435671082365958316831c9960c480451dd0330bcdae304f.svg';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(ShopifyAdapter.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scopes: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('SHOPIFY_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('SHOPIFY_CLIENT_SECRET', '');
    this.scopes = this.config.get<string>(
      'SHOPIFY_SCOPES',
      'read_products,write_products,read_inventory,write_inventory,read_orders,read_fulfillments',
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private baseUrl(shop: string): string {
    const domain = shop.includes('.') ? shop : `${shop}.myshopify.com`;
    return `https://${domain}/admin/api/${API_VERSION}`;
  }

  private async shopifyFetch<T = any>(
    shop: string,
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl(shop)}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    // state encodes tenantId so we can correlate on callback
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    // The shop parameter must be supplied by the caller via query string; the
    // typical flow is: frontend asks the user for their .myshopify.com domain,
    // then navigates to this URL replacing {shop}.
    return (
      `https://{shop}.myshopify.com/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(this.clientId)}` +
      `&scope=${encodeURIComponent(this.scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&grant_options[]=per-user`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const { tenantId, shop } = JSON.parse(Buffer.from(state, 'base64url').toString());
    const domain = shop.includes('.') ? shop : `${shop}.myshopify.com`;

    const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Shopify token exchange failed: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      scope: string;
    };

    // Fetch shop info
    const shopData = await this.shopifyFetch<{ shop: { id: number; name: string } }>(
      domain,
      '/shop.json',
      token.access_token,
    );

    return {
      credentials: {
        accessToken: token.access_token,
        scope: token.scope,
        shop: domain,
      },
      shopId: String(shopData.shop.id),
      shopName: shopData.shop.name,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    // Shopify offline tokens do not expire; return as-is.
    this.logger.debug('Shopify offline tokens do not expire -- returning existing credentials.');
    return credentials;
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const limit = pagination?.limit ?? 50;
    let path = `/products.json?limit=${limit}&fields=id,title,body_html,vendor,product_type,tags,images,variants,status,handle`;

    if (pagination?.cursor) {
      path = `/products.json?limit=${limit}&page_info=${pagination.cursor}`;
    }

    const res = await this.shopifyFetch<{ products: any[] }>(
      creds.shop,
      path,
      creds.accessToken,
    );

    const products: NormalizedProduct[] = res.products.map((p: any) => ({
      platformProductId: String(p.id),
      title: p.title,
      description: p.body_html ?? undefined,
      brand: p.vendor ?? undefined,
      category: p.product_type ?? undefined,
      tags: p.tags ? p.tags.split(', ').filter(Boolean) : [],
      images: (p.images ?? []).map((img: any, idx: number) => ({
        url: img.src,
        platformImageId: String(img.id),
        position: img.position ?? idx,
        width: img.width,
        height: img.height,
        altText: img.alt ?? undefined,
      })),
      variants: (p.variants ?? []).map((v: any) => ({
        platformVariantId: String(v.id),
        sku: v.sku ?? undefined,
        barcode: v.barcode ?? undefined,
        title: v.title ?? undefined,
        options: {
          ...(v.option1 ? { option1: v.option1 } : {}),
          ...(v.option2 ? { option2: v.option2 } : {}),
          ...(v.option3 ? { option3: v.option3 } : {}),
        },
        price: parseFloat(v.price),
        currency: 'USD', // Shopify prices are in shop currency
        compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : undefined,
        weightGrams: v.grams ?? undefined,
        stockQuantity: v.inventory_quantity ?? 0,
      })),
      status: p.status === 'active' ? 'active' : p.status === 'archived' ? 'archived' : 'draft',
      platformUrl: `https://${creds.shop}/admin/products/${p.id}`,
    }));

    // Shopify uses Link header pagination
    // For simplicity, return undefined nextCursor when fewer results than limit
    const nextCursor = res.products.length >= limit ? String(res.products.length) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.shopifyFetch<{ images: any[] }>(
      creds.shop,
      `/products/${productId}/images.json`,
      creds.accessToken,
    );
    return res.images.map((img: any, idx: number) => ({
      url: img.src,
      platformImageId: String(img.id),
      position: img.position ?? idx,
      width: img.width,
      height: img.height,
      altText: img.alt ?? undefined,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const body = {
      product: {
        title: product.title,
        body_html: product.description ?? '',
        vendor: product.brand ?? '',
        product_type: product.category ?? '',
        tags: product.tags?.join(', ') ?? '',
        images: (product.images ?? []).map((img) => ({
          src: img.url,
          alt: img.altText ?? '',
        })),
        variants: product.variants.map((v) => ({
          sku: v.sku,
          barcode: v.barcode ?? '',
          title: v.title ?? v.sku,
          price: String(v.price),
          compare_at_price: v.compareAtPrice ? String(v.compareAtPrice) : null,
          grams: v.weightGrams ?? 0,
          inventory_quantity: v.stockQuantity ?? 0,
          option1: v.options?.option1 ?? null,
          option2: v.options?.option2 ?? null,
          option3: v.options?.option3 ?? null,
        })),
      },
    };

    const res = await this.shopifyFetch<{ product: any }>(
      creds.shop,
      '/products.json',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return {
      platformProductId: String(res.product.id),
      platformVariantIds: (res.product.variants ?? []).map((v: any) => String(v.id)),
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
    if (changes.description !== undefined) update.body_html = changes.description;
    if (changes.tags !== undefined) update.tags = changes.tags.join(', ');
    if (changes.status !== undefined) update.status = changes.status;
    if (changes.images !== undefined) {
      update.images = changes.images.map((img) => ({
        src: img.url,
        alt: img.altText ?? '',
      }));
    }

    await this.shopifyFetch(
      creds.shop,
      `/products/${platformProductId}.json`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify({ product: { id: platformProductId, ...update } }) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    // First find the variant by SKU
    const searchRes = await this.shopifyFetch<{ variants: any[] }>(
      creds.shop,
      `/variants.json?fields=id,sku,inventory_quantity&limit=1`,
      creds.accessToken,
    );
    // The Shopify REST API does not have a direct SKU search; in production
    // you would use GraphQL.  Here we search through products.
    const productsRes = await this.shopifyFetch<{ products: any[] }>(
      creds.shop,
      `/products.json?fields=id,variants&limit=250`,
      creds.accessToken,
    );
    for (const p of productsRes.products) {
      for (const v of p.variants ?? []) {
        if (v.sku === sku) {
          return v.inventory_quantity ?? 0;
        }
      }
    }
    throw new Error(`SKU "${sku}" not found on Shopify store ${creds.shop}`);
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    // Locate inventory_item_id for the SKU
    const productsRes = await this.shopifyFetch<{ products: any[] }>(
      creds.shop,
      `/products.json?fields=id,variants&limit=250`,
      creds.accessToken,
    );
    let inventoryItemId: string | undefined;
    let locationId: string | undefined;

    for (const p of productsRes.products) {
      for (const v of p.variants ?? []) {
        if (v.sku === sku) {
          inventoryItemId = String(v.inventory_item_id);
          break;
        }
      }
      if (inventoryItemId) break;
    }
    if (!inventoryItemId) {
      throw new Error(`SKU "${sku}" not found on Shopify store ${creds.shop}`);
    }

    // Get locations
    const locationsRes = await this.shopifyFetch<{ locations: any[] }>(
      creds.shop,
      '/locations.json',
      creds.accessToken,
    );
    locationId = String(locationsRes.locations[0]?.id);
    if (!locationId) throw new Error('No Shopify location found');

    // Set inventory level
    await this.shopifyFetch(
      creds.shop,
      '/inventory_levels/set.json',
      creds.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: inventoryItemId,
          available: quantity,
        }),
      },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const sinceIso = since.toISOString();
    const res = await this.shopifyFetch<{ orders: any[] }>(
      creds.shop,
      `/orders.json?status=any&created_at_min=${encodeURIComponent(sinceIso)}&limit=250`,
      creds.accessToken,
    );

    return res.orders.map((o: any) => ({
      platformOrderId: String(o.id),
      status: o.financial_status ?? o.fulfillment_status ?? 'unknown',
      currency: o.currency ?? 'USD',
      subtotal: parseFloat(o.subtotal_price ?? '0'),
      taxTotal: parseFloat(o.total_tax ?? '0'),
      shippingTotal: (o.shipping_lines ?? []).reduce(
        (sum: number, s: any) => sum + parseFloat(s.price ?? '0'),
        0,
      ),
      grandTotal: parseFloat(o.total_price ?? '0'),
      customer: o.customer
        ? {
            email: o.customer.email,
            firstName: o.customer.first_name,
            lastName: o.customer.last_name,
            phone: o.customer.phone,
          }
        : undefined,
      shippingAddress: o.shipping_address
        ? {
            name: `${o.shipping_address.first_name ?? ''} ${o.shipping_address.last_name ?? ''}`.trim(),
            company: o.shipping_address.company,
            addressLine1: o.shipping_address.address1,
            addressLine2: o.shipping_address.address2,
            city: o.shipping_address.city,
            province: o.shipping_address.province,
            postalCode: o.shipping_address.zip,
            country: o.shipping_address.country_code,
            phone: o.shipping_address.phone,
          }
        : undefined,
      items: (o.line_items ?? []).map((li: any) => ({
        platformLineItemId: String(li.id),
        sku: li.sku ?? undefined,
        title: li.title,
        quantity: li.quantity,
        unitPrice: parseFloat(li.price ?? '0'),
        totalPrice: parseFloat(li.price ?? '0') * li.quantity,
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
    const hmacHeader =
      headers['x-shopify-hmac-sha256'] ??
      headers['X-Shopify-Hmac-SHA256'] ??
      headers['X-Shopify-Hmac-Sha256'] ??
      '';
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('base64');
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(hmacHeader),
    );
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const rawTopic =
      headers['x-shopify-topic'] ?? headers['X-Shopify-Topic'] ?? 'unknown';
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const deliveryId =
      headers['x-shopify-webhook-id'] ?? headers['X-Shopify-Webhook-Id'] ?? crypto.randomUUID();

    const topicMap: Record<string, string> = {
      'products/create': 'product.created',
      'products/update': 'product.updated',
      'products/delete': 'product.deleted',
      'orders/create': 'order.created',
      'orders/updated': 'order.updated',
      'orders/cancelled': 'order.cancelled',
      'inventory_levels/update': 'inventory.updated',
      'app/uninstalled': 'app.uninstalled',
    };

    return {
      topic: topicMap[rawTopic] ?? rawTopic,
      platformTopic: rawTopic,
      idempotencyKey: deliveryId,
      payload,
      occurredAt: payload.updated_at ?? payload.created_at ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    const topicMap: Record<string, string> = {
      'product.created': 'products/create',
      'product.updated': 'products/update',
      'product.deleted': 'products/delete',
      'order.created': 'orders/create',
      'order.updated': 'orders/updated',
      'order.cancelled': 'orders/cancelled',
      'inventory.updated': 'inventory_levels/update',
      'app.uninstalled': 'app/uninstalled',
    };

    const shopifyTopic = topicMap[topic] ?? topic;

    await this.shopifyFetch(
      creds.shop,
      '/webhooks.json',
      creds.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          webhook: {
            topic: shopifyTopic,
            address: callbackUrl,
            format: 'json',
          },
        }),
      },
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    return { requestsPerSecond: 2, burstLimit: 40 };
  }
}
