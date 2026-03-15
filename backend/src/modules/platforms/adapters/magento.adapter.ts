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
 * Magento 2 / Adobe Commerce adapter.
 *
 * Supports two authentication modes:
 *   1. Bearer token (Integration access token generated in Magento admin)
 *   2. OAuth 1.0a (three-legged flow)
 *
 * The bearer-token mode is far more common for headless integrations so
 * this adapter defaults to it.  OAuth support is included for marketplace
 * multi-tenant scenarios.
 */

@Injectable()
export class MagentoAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.magento;
  readonly displayName = 'Magento / Adobe Commerce';
  readonly logoUrl = 'https://upload.wikimedia.org/wikipedia/en/5/53/Magento.svg';
  readonly authType: AuthType = 'bearer';

  private readonly logger = new Logger(MagentoAdapter.name);
  private readonly oauthConsumerKey: string;
  private readonly oauthConsumerSecret: string;

  constructor(private readonly config: ConfigService) {
    this.oauthConsumerKey = this.config.get<string>('MAGENTO_OAUTH_CONSUMER_KEY', '');
    this.oauthConsumerSecret = this.config.get<string>('MAGENTO_OAUTH_CONSUMER_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private baseUrl(storeUrl: string): string {
    return `${storeUrl.replace(/\/+$/, '')}/rest/V1`;
  }

  private async magentoFetch<T = any>(
    storeUrl: string,
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl(storeUrl)}${path}`;
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
      throw new Error(`Magento API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    // For bearer-token auth (most common), there is no redirect flow.
    // The frontend should display a form that asks for storeUrl + access token.
    // For OAuth 1.0a, the flow starts at {storeUrl}/oauth/authorize.
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    // Placeholder -- frontend will replace {storeUrl}
    return (
      `{storeUrl}/oauth/authorize` +
      `?oauth_consumer_key=${encodeURIComponent(this.oauthConsumerKey)}` +
      `&callback_url=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    // "code" is either:
    //   a) JSON with { storeUrl, accessToken } for bearer token mode, or
    //   b) JSON with { storeUrl, oauthToken, oauthTokenSecret, oauthVerifier } for OAuth
    const data = JSON.parse(code) as {
      storeUrl: string;
      accessToken?: string;
      oauthToken?: string;
      oauthTokenSecret?: string;
      oauthVerifier?: string;
    };

    let token: string;

    if (data.accessToken) {
      // Bearer token mode -- token is already available
      token = data.accessToken;
    } else if (data.oauthToken && data.oauthVerifier) {
      // OAuth 1.0a -- exchange for access token
      const res = await fetch(
        `${data.storeUrl.replace(/\/+$/, '')}/oauth/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            oauth_consumer_key: this.oauthConsumerKey,
            oauth_consumer_secret: this.oauthConsumerSecret,
            oauth_token: data.oauthToken,
            oauth_token_secret: data.oauthTokenSecret ?? '',
            oauth_verifier: data.oauthVerifier,
          }).toString(),
        },
      );
      if (!res.ok) throw new Error(`Magento OAuth exchange failed: ${await res.text()}`);
      const body = await res.text();
      const params = new URLSearchParams(body);
      token = params.get('oauth_token') ?? '';
      // Also store the token secret for subsequent OAuth 1.0a requests
    } else {
      throw new Error('Invalid Magento callback data -- expected accessToken or OAuth params');
    }

    // Fetch store info
    const storeConfigs = await this.magentoFetch<any[]>(
      data.storeUrl,
      '/store/storeConfigs',
      token,
    );
    const primary = storeConfigs?.[0] ?? {};

    return {
      credentials: {
        accessToken: token,
        storeUrl: data.storeUrl,
        oauthTokenSecret: data.oauthTokenSecret,
      },
      shopId: String(primary.id ?? data.storeUrl),
      shopName: primary.store_name ?? primary.base_url ?? data.storeUrl,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    // Magento integration access tokens do not expire.
    // OAuth tokens are also long-lived.  Return as-is.
    return credentials;
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.limit ?? 50;

    // Magento uses searchCriteria query params
    const searchCriteria = [
      `searchCriteria[currentPage]=${page}`,
      `searchCriteria[pageSize]=${pageSize}`,
    ].join('&');

    const res = await this.magentoFetch<{
      items: any[];
      total_count: number;
      search_criteria: any;
    }>(creds.storeUrl, `/products?${searchCriteria}`, creds.accessToken);

    const products: NormalizedProduct[] = (res.items ?? []).map((p: any) => {
      const findAttr = (code: string) =>
        p.custom_attributes?.find((a: any) => a.attribute_code === code)?.value;

      return {
        platformProductId: String(p.id),
        title: p.name ?? '',
        description: findAttr('description') ?? findAttr('short_description') ?? undefined,
        brand: findAttr('brand') ?? undefined,
        category: undefined, // Categories require separate API call
        tags: [],
        images: (p.media_gallery_entries ?? []).map((img: any, idx: number) => ({
          url: img.file
            ? `${creds.storeUrl}/pub/media/catalog/product${img.file}`
            : '',
          platformImageId: String(img.id),
          position: img.position ?? idx,
          altText: img.label ?? undefined,
        })),
        variants: (p.extension_attributes?.configurable_product_links ?? [p]).length > 0
          ? [
              {
                platformVariantId: String(p.id),
                sku: p.sku,
                barcode: findAttr('barcode') ?? findAttr('ean') ?? undefined,
                title: p.name,
                options: {},
                price: p.price ?? 0,
                currency: 'USD', // Magento doesn't embed currency in product
                compareAtPrice: findAttr('special_price')
                  ? p.price
                  : undefined,
                weightGrams: p.weight ? p.weight * 1000 : undefined,
                stockQuantity: p.extension_attributes?.stock_item?.qty ?? 0,
              },
            ]
          : [],
        status: p.status === 1 ? 'active' : 'draft',
        platformUrl: findAttr('url_key')
          ? `${creds.storeUrl}/${findAttr('url_key')}.html`
          : undefined,
      };
    });

    const totalPages = Math.ceil((res.total_count ?? 0) / pageSize);
    const nextCursor = page < totalPages ? String(page + 1) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    // Fetch product by ID (need SKU, so first get the product)
    const product = await this.magentoFetch<any>(
      creds.storeUrl,
      `/products/${encodeURIComponent(productId)}`,
      creds.accessToken,
    );
    return (product.media_gallery_entries ?? []).map((img: any, idx: number) => ({
      url: img.file ? `${creds.storeUrl}/pub/media/catalog/product${img.file}` : '',
      platformImageId: String(img.id),
      position: img.position ?? idx,
      altText: img.label ?? undefined,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const primaryVariant = product.variants[0];

    const body = {
      product: {
        sku: primaryVariant?.sku ?? `LP-${Date.now()}`,
        name: product.title,
        price: primaryVariant?.price ?? 0,
        status: 1, // enabled
        visibility: 4, // catalog, search
        type_id: product.variants.length > 1 ? 'configurable' : 'simple',
        attribute_set_id: 4, // Default attribute set
        weight: primaryVariant?.weightGrams
          ? primaryVariant.weightGrams / 1000
          : 0,
        custom_attributes: [
          { attribute_code: 'description', value: product.description ?? '' },
          { attribute_code: 'short_description', value: product.description ?? '' },
        ],
        extension_attributes: {
          stock_item: {
            qty: primaryVariant?.stockQuantity ?? 0,
            is_in_stock: (primaryVariant?.stockQuantity ?? 0) > 0,
          },
        },
      },
    };

    const created = await this.magentoFetch<any>(
      creds.storeUrl,
      '/products',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    const variantIds: string[] = [String(created.id)];

    // Upload images
    for (const [idx, img] of (product.images ?? []).entries()) {
      try {
        await this.magentoFetch(
          creds.storeUrl,
          `/products/${encodeURIComponent(created.sku)}/media`,
          creds.accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              entry: {
                media_type: 'image',
                label: img.altText ?? `Image ${idx + 1}`,
                position: img.position ?? idx,
                disabled: false,
                types: idx === 0 ? ['image', 'small_image', 'thumbnail'] : [],
                content: {
                  base64_encoded_data: '', // In production, encode the image
                  type: 'image/jpeg',
                  name: `product-${idx}.jpg`,
                },
              },
            }),
          },
        );
      } catch (e) {
        this.logger.warn(`Image upload failed for Magento product ${created.sku}: ${e}`);
      }
    }

    // Create child simple products for configurable
    if (product.variants.length > 1) {
      for (const v of product.variants.slice(1)) {
        try {
          const child = await this.magentoFetch<any>(
            creds.storeUrl,
            '/products',
            creds.accessToken,
            {
              method: 'POST',
              body: JSON.stringify({
                product: {
                  sku: v.sku,
                  name: v.title ?? `${product.title} - ${v.sku}`,
                  price: v.price,
                  status: 1,
                  visibility: 1, // Not visible individually
                  type_id: 'simple',
                  attribute_set_id: 4,
                  extension_attributes: {
                    stock_item: {
                      qty: v.stockQuantity ?? 0,
                      is_in_stock: (v.stockQuantity ?? 0) > 0,
                    },
                  },
                },
              }),
            },
          );
          variantIds.push(String(child.id));

          // Link child to configurable parent
          await this.magentoFetch(
            creds.storeUrl,
            `/configurable-products/${encodeURIComponent(created.sku)}/child`,
            creds.accessToken,
            {
              method: 'POST',
              body: JSON.stringify({ childSku: v.sku }),
            },
          );
        } catch (e) {
          this.logger.warn(`Failed to create Magento variant ${v.sku}: ${e}`);
        }
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
    // First fetch the product to get its SKU
    const existing = await this.magentoFetch<any>(
      creds.storeUrl,
      `/products/${encodeURIComponent(platformProductId)}`,
      creds.accessToken,
    );

    const update: Record<string, unknown> = { sku: existing.sku };
    if (changes.title !== undefined) update.name = changes.title;
    if (changes.price !== undefined) update.price = changes.price;
    if (changes.status !== undefined) {
      update.status = changes.status === 'active' ? 1 : 2;
    }

    const customAttributes: any[] = [];
    if (changes.description !== undefined) {
      customAttributes.push(
        { attribute_code: 'description', value: changes.description },
      );
    }
    if (customAttributes.length) {
      (update as any).custom_attributes = customAttributes;
    }

    await this.magentoFetch(
      creds.storeUrl,
      `/products/${encodeURIComponent(existing.sku)}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify({ product: update }) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const stockItem = await this.magentoFetch<{
      qty: number;
      is_in_stock: boolean;
    }>(creds.storeUrl, `/stockItems/${encodeURIComponent(sku)}`, creds.accessToken);
    return stockItem.qty ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    // Get existing stock item first
    const stockItem = await this.magentoFetch<any>(
      creds.storeUrl,
      `/stockItems/${encodeURIComponent(sku)}`,
      creds.accessToken,
    );

    await this.magentoFetch(
      creds.storeUrl,
      `/products/${encodeURIComponent(sku)}/stockItems/${stockItem.item_id}`,
      creds.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          stockItem: {
            qty: quantity,
            is_in_stock: quantity > 0,
          },
        }),
      },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const sinceStr = since.toISOString().replace('T', ' ').split('.')[0]; // Magento expects Y-m-d H:i:s
    const searchCriteria = [
      `searchCriteria[filter_groups][0][filters][0][field]=created_at`,
      `searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(sinceStr)}`,
      `searchCriteria[filter_groups][0][filters][0][condition_type]=gteq`,
      `searchCriteria[pageSize]=100`,
    ].join('&');

    const res = await this.magentoFetch<{
      items: any[];
      total_count: number;
    }>(creds.storeUrl, `/orders?${searchCriteria}`, creds.accessToken);

    return (res.items ?? []).map((o: any) => ({
      platformOrderId: String(o.entity_id ?? o.increment_id),
      status: o.status ?? 'unknown',
      currency: o.order_currency_code ?? o.base_currency_code ?? 'USD',
      subtotal: parseFloat(o.subtotal ?? '0'),
      taxTotal: parseFloat(o.tax_amount ?? '0'),
      shippingTotal: parseFloat(o.shipping_amount ?? '0'),
      grandTotal: parseFloat(o.grand_total ?? '0'),
      customer: {
        email: o.customer_email,
        firstName: o.customer_firstname,
        lastName: o.customer_lastname,
      },
      shippingAddress: o.extension_attributes?.shipping_assignments?.[0]?.shipping?.address
        ? (() => {
            const addr =
              o.extension_attributes.shipping_assignments[0].shipping.address;
            return {
              name: `${addr.firstname ?? ''} ${addr.lastname ?? ''}`.trim(),
              company: addr.company,
              addressLine1: addr.street?.[0],
              addressLine2: addr.street?.[1],
              city: addr.city,
              province: addr.region,
              postalCode: addr.postcode,
              country: addr.country_id,
              phone: addr.telephone,
            };
          })()
        : undefined,
      items: (o.items ?? []).map((li: any) => ({
        platformLineItemId: String(li.item_id),
        sku: li.sku ?? undefined,
        title: li.name,
        quantity: li.qty_ordered ?? 1,
        unitPrice: parseFloat(li.price ?? '0'),
        totalPrice: parseFloat(li.row_total ?? '0'),
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
    // Magento does not have built-in webhook signing.
    // When using a custom webhook module (e.g. magento-webhooks), the
    // signature is typically sent as x-magento-signature using HMAC-SHA256.
    const signature =
      headers['x-magento-signature'] ?? headers['X-Magento-Signature'] ?? '';
    if (!signature) return false;
    const digest = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : body)
      .digest('hex');
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
    const rawEvent = payload.event ?? headers['x-magento-topic'] ?? 'unknown';

    const topicMap: Record<string, string> = {
      'catalog_product_save_after': 'product.updated',
      'catalog_product_delete_after': 'product.deleted',
      'sales_order_place_after': 'order.created',
      'sales_order_save_after': 'order.updated',
      'cataloginventory_stock_item_save_after': 'inventory.updated',
    };

    return {
      topic: topicMap[rawEvent] ?? rawEvent,
      platformTopic: rawEvent,
      idempotencyKey: payload.event_id ?? payload.id ?? crypto.randomUUID(),
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
    // Magento does not ship with a native webhook API.
    // Third-party modules (e.g. Mageplaza, custom) expose webhook registration.
    // We attempt to POST to a conventional endpoint.
    const topicMap: Record<string, string> = {
      'product.created': 'catalog_product_save_after',
      'product.updated': 'catalog_product_save_after',
      'product.deleted': 'catalog_product_delete_after',
      'order.created': 'sales_order_place_after',
      'order.updated': 'sales_order_save_after',
      'inventory.updated': 'cataloginventory_stock_item_save_after',
    };

    try {
      await this.magentoFetch(
        creds.storeUrl,
        '/webhooks',
        creds.accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            event: topicMap[topic] ?? topic,
            url: callbackUrl,
            status: 1,
          }),
        },
      );
    } catch (e) {
      this.logger.warn(
        `Magento webhook registration failed (requires a webhook extension): ${e}`,
      );
    }
  }

  getRateLimitConfig(): RateLimitConfig {
    // Magento rate limits depend on hosting; these are conservative defaults.
    return { requestsPerSecond: 10, burstLimit: 50 };
  }
}
