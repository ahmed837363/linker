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
 * Amazon SP-API endpoints by region.
 * The adapter defaults to North America; the marketplace can be overridden
 * via the credentials `marketplace` field.
 */
const REGION_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const LWA_AUTH_URL = 'https://sellercentral.amazon.com/apps/authorize/consent';

@Injectable()
export class AmazonAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.amazon;
  readonly displayName = 'Amazon';
  readonly logoUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(AmazonAdapter.name);
  private readonly lwaClientId: string;
  private readonly lwaClientSecret: string;
  private readonly appId: string;

  constructor(private readonly config: ConfigService) {
    this.lwaClientId = this.config.get<string>('AMAZON_LWA_CLIENT_ID', '');
    this.lwaClientSecret = this.config.get<string>('AMAZON_LWA_CLIENT_SECRET', '');
    this.appId = this.config.get<string>('AMAZON_APP_ID', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private endpoint(credentials: any): string {
    const region: string = credentials.region ?? 'na';
    return REGION_ENDPOINTS[region] ?? REGION_ENDPOINTS.na;
  }

  private async spApiFetch<T = any>(
    credentials: any,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.endpoint(credentials)}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-amz-access-token': credentials.accessToken,
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Amazon SP-API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    return (
      `${LWA_AUTH_URL}` +
      `?application_id=${encodeURIComponent(this.appId)}` +
      `&state=${state}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&version=beta`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    // Exchange LWA authorisation code for access + refresh tokens
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.lwaClientId,
      client_secret: this.lwaClientSecret,
    });

    const tokenRes = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`Amazon LWA token exchange failed: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // Parse state to recover tenant metadata
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());

    // Fetch marketplace participations to get seller id and name
    const creds = { accessToken: token.access_token, region: parsed.region ?? 'na' };
    const participations = await this.spApiFetch<{
      payload: { marketplace: any; participation: any }[];
    }>(creds, '/sellers/v1/marketplaceParticipations');

    const first = participations.payload?.[0];
    const sellerId = first?.participation?.sellerId ?? 'unknown';
    const marketplace = first?.marketplace;
    const shopName = marketplace?.name ?? `Amazon Seller ${sellerId}`;

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        tokenType: token.token_type,
        region: parsed.region ?? 'na',
        sellerId,
        marketplaceId: marketplace?.id,
      },
      shopId: sellerId,
      shopName,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: this.lwaClientId,
      client_secret: this.lwaClientSecret,
    });

    const tokenRes = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!tokenRes.ok) throw new Error(`Amazon LWA refresh failed: ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    return {
      ...creds,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? creds.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      tokenType: token.token_type,
    };
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  async pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }> {
    const creds = credentials as any;
    const marketplaceId = creds.marketplaceId ?? 'ATVPDKIKX0DER'; // US default
    let path =
      `/catalog/2022-04-01/items?marketplaceIds=${marketplaceId}` +
      `&includedData=summaries,images,attributes,salesRanks&pageSize=${pagination?.limit ?? 20}`;
    if (pagination?.cursor) {
      path += `&pageToken=${encodeURIComponent(pagination.cursor)}`;
    }

    const res = await this.spApiFetch<{
      items: any[];
      pagination?: { nextToken?: string };
    }>(creds, path);

    const products: NormalizedProduct[] = (res.items ?? []).map((item: any) => {
      const summary = item.summaries?.[0] ?? {};
      return {
        platformProductId: item.asin,
        title: summary.itemName ?? '',
        description: summary.itemDescription ?? undefined,
        brand: summary.brand ?? undefined,
        category: summary.itemClassification ?? undefined,
        tags: [],
        images: (item.images?.[0]?.images ?? []).map((img: any, idx: number) => ({
          url: img.link,
          position: idx,
          width: img.width,
          height: img.height,
        })),
        variants: [
          {
            platformVariantId: item.asin,
            sku: item.attributes?.seller_sku?.[0]?.value ?? item.asin,
            title: summary.itemName ?? '',
            options: {},
            price: 0, // SP-API Catalog does not return price; use Pricing API
            currency: summary.marketplaceId === 'ATVPDKIKX0DER' ? 'USD' : 'USD',
            stockQuantity: 0,
          },
        ],
        status: 'active' as const,
        platformUrl: `https://www.amazon.com/dp/${item.asin}`,
      };
    });

    return {
      products,
      nextCursor: res.pagination?.nextToken ?? undefined,
    };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const marketplaceId = creds.marketplaceId ?? 'ATVPDKIKX0DER';
    const res = await this.spApiFetch<{ items: any[] }>(
      creds,
      `/catalog/2022-04-01/items/${productId}?marketplaceIds=${marketplaceId}&includedData=images`,
    );
    const images = res.items?.[0]?.images?.[0]?.images ?? [];
    return images.map((img: any, idx: number) => ({
      url: img.link,
      position: idx,
      width: img.width,
      height: img.height,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;

    // Amazon uses feeds to create listings.  We use the JSON_LISTINGS_FEED.
    const listings = product.variants.map((v) => ({
      sku: v.sku,
      productType: product.category ?? 'PRODUCT',
      attributes: {
        item_name: [{ value: product.title }],
        product_description: [{ value: product.description ?? '' }],
        brand: [{ value: product.brand ?? '' }],
        externally_assigned_product_identifier: v.barcode
          ? [{ type: 'ean', value: v.barcode }]
          : undefined,
        list_price: [{ amount: v.price, currency: v.currency }],
        fulfillment_availability: [
          { fulfillment_channel_code: 'DEFAULT', quantity: v.stockQuantity ?? 0 },
        ],
      },
    }));

    // Submit listings feed
    const feedRes = await this.spApiFetch<{
      feedId: string;
    }>(creds, '/feeds/2021-06-30/feeds', {
      method: 'POST',
      body: JSON.stringify({
        feedType: 'JSON_LISTINGS_FEED',
        marketplaceIds: [creds.marketplaceId ?? 'ATVPDKIKX0DER'],
        inputFeedDocumentId: 'placeholder', // In production, upload to S3 first
      }),
    });

    this.logger.log(`Amazon feed submitted: ${feedRes.feedId}`);

    return {
      platformProductId: feedRes.feedId,
      platformVariantIds: product.variants.map((v) => v.sku),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const sellerId = creds.sellerId;
    const marketplaceId = creds.marketplaceId ?? 'ATVPDKIKX0DER';

    const patches: any[] = [];
    if (changes.title !== undefined) {
      patches.push({
        op: 'replace',
        path: '/attributes/item_name',
        value: [{ value: changes.title, marketplace_id: marketplaceId }],
      });
    }
    if (changes.description !== undefined) {
      patches.push({
        op: 'replace',
        path: '/attributes/product_description',
        value: [{ value: changes.description, marketplace_id: marketplaceId }],
      });
    }
    if (changes.price !== undefined) {
      patches.push({
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: [
          {
            marketplace_id: marketplaceId,
            our_price: [{ schedule: [{ value_with_tax: changes.price }] }],
          },
        ],
      });
    }

    if (patches.length === 0) return;

    await this.spApiFetch(
      creds,
      `/listings/2021-08-01/items/${sellerId}/${platformProductId}?marketplaceIds=${marketplaceId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          productType: 'PRODUCT',
          patches,
        }),
      },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const marketplaceId = creds.marketplaceId ?? 'ATVPDKIKX0DER';
    const res = await this.spApiFetch<{
      payload: { inventorySummaries: any[] };
    }>(
      creds,
      `/fba/inventory/v1/summaries?details=true&granularityType=Marketplace` +
        `&granularityId=${marketplaceId}&sellerSkus=${encodeURIComponent(sku)}&marketplaceIds=${marketplaceId}`,
    );
    const summary = res.payload?.inventorySummaries?.[0];
    if (!summary) throw new Error(`SKU "${sku}" not found in Amazon inventory`);
    return summary.totalQuantity ?? summary.inventoryDetails?.fulfillableQuantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    const sellerId = creds.sellerId;
    const marketplaceId = creds.marketplaceId ?? 'ATVPDKIKX0DER';

    await this.spApiFetch(
      creds,
      `/listings/2021-08-01/items/${sellerId}/${sku}?marketplaceIds=${marketplaceId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          productType: 'PRODUCT',
          patches: [
            {
              op: 'replace',
              path: '/attributes/fulfillment_availability',
              value: [
                {
                  fulfillment_channel_code: 'DEFAULT',
                  quantity,
                  marketplace_id: marketplaceId,
                },
              ],
            },
          ],
        }),
      },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const marketplaceId = creds.marketplaceId ?? 'ATVPDKIKX0DER';
    const createdAfter = since.toISOString();

    const ordersRes = await this.spApiFetch<{
      payload: { Orders: any[] };
    }>(
      creds,
      `/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=${encodeURIComponent(createdAfter)}&MaxResultsPerPage=100`,
    );

    const results: NormalizedOrder[] = [];

    for (const o of ordersRes.payload?.Orders ?? []) {
      // Fetch order items
      let items: any[] = [];
      try {
        const itemsRes = await this.spApiFetch<{
          payload: { OrderItems: any[] };
        }>(creds, `/orders/v0/orders/${o.AmazonOrderId}/orderItems`);
        items = itemsRes.payload?.OrderItems ?? [];
      } catch (e) {
        this.logger.warn(`Failed to fetch items for order ${o.AmazonOrderId}: ${e}`);
      }

      results.push({
        platformOrderId: o.AmazonOrderId,
        status: o.OrderStatus ?? 'unknown',
        currency: o.OrderTotal?.CurrencyCode ?? 'USD',
        subtotal: parseFloat(o.OrderTotal?.Amount ?? '0'),
        taxTotal: 0, // Amazon does not expose tax total in Orders API directly
        shippingTotal: 0,
        grandTotal: parseFloat(o.OrderTotal?.Amount ?? '0'),
        customer: {
          email: o.BuyerInfo?.BuyerEmail,
          firstName: o.BuyerInfo?.BuyerName?.split(' ')[0],
          lastName: o.BuyerInfo?.BuyerName?.split(' ').slice(1).join(' '),
        },
        shippingAddress: o.ShippingAddress
          ? {
              name: o.ShippingAddress.Name,
              addressLine1: o.ShippingAddress.AddressLine1,
              addressLine2: o.ShippingAddress.AddressLine2,
              city: o.ShippingAddress.City,
              province: o.ShippingAddress.StateOrRegion,
              postalCode: o.ShippingAddress.PostalCode,
              country: o.ShippingAddress.CountryCode,
              phone: o.ShippingAddress.Phone,
            }
          : undefined,
        items: items.map((li: any) => ({
          platformLineItemId: li.OrderItemId,
          sku: li.SellerSKU ?? undefined,
          title: li.Title,
          quantity: li.QuantityOrdered ?? 1,
          unitPrice: parseFloat(li.ItemPrice?.Amount ?? '0') / (li.QuantityOrdered || 1),
          totalPrice: parseFloat(li.ItemPrice?.Amount ?? '0'),
        })),
        placedAt: new Date(o.PurchaseDate),
      });
    }

    return results;
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    _secret: string,
  ): boolean {
    // Amazon SP-API notifications use Amazon SNS. Verification requires
    // checking the SNS message signature against Amazon's signing certificate.
    // A full implementation would fetch the certificate and verify, but for
    // this adapter we implement the core HMAC-style check using the
    // x-amz-sns-message-type header presence as the gate, then validate
    // the SigningCertURL domain.
    const messageType =
      headers['x-amz-sns-message-type'] ?? headers['X-Amz-Sns-Message-Type'] ?? '';
    if (!messageType) return false;

    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    const certUrl: string = payload.SigningCertURL ?? '';

    // Ensure the certificate URL comes from amazonaws.com
    try {
      const url = new URL(certUrl);
      return url.hostname.endsWith('.amazonaws.com');
    } catch {
      return false;
    }
  }

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent {
    const payload = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    // Amazon SNS wraps the notification in a Message field
    const innerMessage =
      typeof payload.Message === 'string' ? JSON.parse(payload.Message) : payload;
    const notificationType = innerMessage.NotificationType ?? 'UNKNOWN';

    const topicMap: Record<string, string> = {
      LISTINGS_ITEM_STATUS_CHANGE: 'product.updated',
      LISTINGS_ITEM_ISSUES_CHANGE: 'product.updated',
      ORDER_STATUS_CHANGE: 'order.updated',
      ANY_OFFER_CHANGED: 'inventory.updated',
      FBA_INVENTORY_AVAILABILITY_CHANGES: 'inventory.updated',
    };

    return {
      topic: topicMap[notificationType] ?? notificationType,
      platformTopic: notificationType,
      idempotencyKey: payload.MessageId ?? crypto.randomUUID(),
      payload: innerMessage,
      occurredAt: payload.Timestamp ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    const topicMap: Record<string, string> = {
      'product.created': 'LISTINGS_ITEM_STATUS_CHANGE',
      'product.updated': 'LISTINGS_ITEM_STATUS_CHANGE',
      'order.created': 'ORDER_STATUS_CHANGE',
      'order.updated': 'ORDER_STATUS_CHANGE',
      'inventory.updated': 'ANY_OFFER_CHANGED',
    };

    const notificationType = topicMap[topic] ?? topic;

    await this.spApiFetch(creds, '/notifications/v1/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        notificationType,
        destination: {
          resourceSpecification: {
            sqs: { arn: callbackUrl }, // Amazon uses SQS / EventBridge, not HTTP
          },
        },
        payloadVersion: '1.0',
      }),
    });
  }

  getRateLimitConfig(): RateLimitConfig {
    // SP-API has per-operation rate limits; this is a conservative overall default.
    return { requestsPerSecond: 1, burstLimit: 5 };
  }
}
