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

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_API_BASE = 'https://api.ebay.com';

@Injectable()
export class EbayAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.ebay;
  readonly displayName = 'eBay';
  readonly logoUrl = 'https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(EbayAdapter.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly ruName: string; // eBay Redirect URL Name

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('EBAY_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('EBAY_CLIENT_SECRET', '');
    this.ruName = this.config.get<string>('EBAY_RU_NAME', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private basicAuth(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
  }

  private async ebayFetch<T = any>(
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${EBAY_API_BASE}${path}`;
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
      throw new Error(`eBay API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    const scopes = [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.marketing',
      'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ].join(' ');

    return (
      `${EBAY_AUTH_URL}` +
      `?client_id=${encodeURIComponent(this.clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(this.ruName || redirectUri)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${state}`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.ruName,
    });

    const tokenRes = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.basicAuth(),
      },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`eBay token exchange failed: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // Fetch user info
    const userInfo = await this.ebayFetch<{ userId: string; username: string }>(
      '/commerce/identity/v1/user/',
      token.access_token,
    );

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        tokenType: token.token_type,
      },
      shopId: userInfo.userId ?? '',
      shopName: userInfo.username ?? 'eBay Seller',
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    });

    const tokenRes = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.basicAuth(),
      },
      body: body.toString(),
    });
    if (!tokenRes.ok) throw new Error(`eBay refresh failed: ${await tokenRes.text()}`);
    const token = (await tokenRes.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };
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
    const limit = pagination?.limit ?? 25;
    const offset = pagination?.cursor ? parseInt(pagination.cursor, 10) : 0;

    const res = await this.ebayFetch<{
      inventoryItems: any[];
      total: number;
      next?: string;
    }>(
      `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
      creds.accessToken,
    );

    const products: NormalizedProduct[] = (res.inventoryItems ?? []).map((item: any) => ({
      platformProductId: item.sku,
      title: item.product?.title ?? '',
      description: item.product?.description ?? undefined,
      brand: item.product?.brand ?? undefined,
      category: item.product?.aspects?.Category?.[0] ?? undefined,
      tags: [],
      images: (item.product?.imageUrls ?? []).map((url: string, idx: number) => ({
        url,
        position: idx,
      })),
      variants: [
        {
          platformVariantId: item.sku,
          sku: item.sku,
          barcode: item.product?.ean?.[0] ?? item.product?.upc?.[0] ?? undefined,
          title: item.product?.title ?? '',
          options: item.product?.aspects ?? {},
          price: item.availability?.offers?.[0]?.price?.value
            ? parseFloat(item.availability.offers[0].price.value)
            : 0,
          currency: item.availability?.offers?.[0]?.price?.currency ?? 'USD',
          stockQuantity:
            item.availability?.shipToLocationAvailability?.quantity ?? 0,
        },
      ],
      status: item.availability ? 'active' : 'draft',
    }));

    const nextOffset = offset + limit;
    const nextCursor = nextOffset < (res.total ?? 0) ? String(nextOffset) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const item = await this.ebayFetch<any>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(productId)}`,
      creds.accessToken,
    );
    return (item.product?.imageUrls ?? []).map((url: string, idx: number) => ({
      url,
      position: idx,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const primaryVariant = product.variants[0];
    const sku = primaryVariant?.sku ?? `LP-${Date.now()}`;

    const inventoryItem = {
      availability: {
        shipToLocationAvailability: {
          quantity: primaryVariant?.stockQuantity ?? 0,
        },
      },
      condition: 'NEW',
      product: {
        title: product.title,
        description: product.description ?? '',
        brand: product.brand,
        imageUrls: (product.images ?? []).map((img) => img.url),
        aspects: product.category ? { Category: [product.category] } : {},
      },
    };

    // Create or replace inventory item
    await this.ebayFetch(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify(inventoryItem) },
    );

    // Create offer for the inventory item
    const offer = {
      sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      listingDescription: product.description ?? '',
      pricingSummary: {
        price: {
          value: String(primaryVariant.price),
          currency: primaryVariant.currency,
        },
      },
      quantityLimitPerBuyer: 10,
    };

    const offerRes = await this.ebayFetch<{ offerId: string }>(
      '/sell/inventory/v1/offer',
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(offer) },
    );

    // Publish the offer to create an active listing
    try {
      await this.ebayFetch(
        `/sell/inventory/v1/offer/${offerRes.offerId}/publish`,
        creds.accessToken,
        { method: 'POST' },
      );
    } catch (e) {
      this.logger.warn(`Could not publish eBay offer ${offerRes.offerId}: ${e}`);
    }

    return {
      platformProductId: sku,
      platformVariantIds: product.variants.map((v) => v.sku),
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    // Fetch existing inventory item
    const existing = await this.ebayFetch<any>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(platformProductId)}`,
      creds.accessToken,
    );

    const update: any = { ...existing };
    if (changes.title !== undefined) {
      update.product = { ...update.product, title: changes.title };
    }
    if (changes.description !== undefined) {
      update.product = { ...update.product, description: changes.description };
    }
    if (changes.images !== undefined) {
      update.product = {
        ...update.product,
        imageUrls: changes.images.map((img) => img.url),
      };
    }

    await this.ebayFetch(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(platformProductId)}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify(update) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const item = await this.ebayFetch<any>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      creds.accessToken,
    );
    return item.availability?.shipToLocationAvailability?.quantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    // Fetch existing, update quantity, PUT back
    const item = await this.ebayFetch<any>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      creds.accessToken,
    );
    item.availability = {
      ...(item.availability ?? {}),
      shipToLocationAvailability: { quantity },
    };

    await this.ebayFetch(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      creds.accessToken,
      { method: 'PUT', body: JSON.stringify(item) },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const filter = `creationdate:[${since.toISOString()}..${new Date().toISOString()}]`;
    const res = await this.ebayFetch<{
      orders: any[];
      total: number;
    }>(
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=100`,
      creds.accessToken,
    );

    return (res.orders ?? []).map((o: any) => ({
      platformOrderId: o.orderId,
      status: o.orderFulfillmentStatus ?? o.cancelStatus?.cancelState ?? 'unknown',
      currency: o.pricingSummary?.total?.currency ?? 'USD',
      subtotal: parseFloat(o.pricingSummary?.priceSubtotal?.value ?? '0'),
      taxTotal: parseFloat(o.pricingSummary?.tax?.value ?? '0'),
      shippingTotal: parseFloat(o.pricingSummary?.deliveryCost?.value ?? '0'),
      grandTotal: parseFloat(o.pricingSummary?.total?.value ?? '0'),
      customer: o.buyer
        ? {
            email: o.buyer.buyerRegistrationAddress?.email,
            firstName: o.buyer.buyerRegistrationAddress?.fullName?.split(' ')[0],
            lastName: o.buyer.buyerRegistrationAddress?.fullName?.split(' ').slice(1).join(' '),
          }
        : undefined,
      shippingAddress: o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo
        ? {
            name: o.fulfillmentStartInstructions[0].shippingStep.shipTo.fullName,
            addressLine1:
              o.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.addressLine1,
            addressLine2:
              o.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.addressLine2,
            city: o.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.city,
            province:
              o.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress
                ?.stateOrProvince,
            postalCode:
              o.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.postalCode,
            country:
              o.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress?.countryCode,
            phone: o.fulfillmentStartInstructions[0].shippingStep.shipTo.primaryPhone?.phoneNumber,
          }
        : undefined,
      items: (o.lineItems ?? []).map((li: any) => ({
        platformLineItemId: li.lineItemId,
        sku: li.sku ?? undefined,
        title: li.title,
        quantity: li.quantity ?? 1,
        unitPrice: parseFloat(li.lineItemCost?.value ?? '0') / (li.quantity || 1),
        totalPrice: parseFloat(li.lineItemCost?.value ?? '0'),
      })),
      placedAt: new Date(o.creationDate),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    // eBay sends a challenge for webhook endpoint verification.
    // For notification validation they send X-EBAY-SIGNATURE header.
    // The signature is a JWE/JWS token; for simplicity we verify the HMAC digest.
    const signature =
      headers['x-ebay-signature'] ?? headers['X-EBAY-SIGNATURE'] ?? '';
    if (!signature) return false;

    // eBay's production webhook verification uses public key JWE.
    // As a fallback, compute HMAC-SHA256 for custom endpoint validation.
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
    const rawTopic = payload.metadata?.topic ?? payload.topic ?? 'unknown';

    const topicMap: Record<string, string> = {
      'marketplace.account.deletion': 'app.uninstalled',
      'commerce.inventory.item.updated': 'inventory.updated',
      'commerce.sell.order.created': 'order.created',
      'commerce.sell.order.updated': 'order.updated',
    };

    return {
      topic: topicMap[rawTopic] ?? rawTopic,
      platformTopic: rawTopic,
      idempotencyKey:
        payload.metadata?.eventId ?? payload.notificationId ?? crypto.randomUUID(),
      payload: payload.notification ?? payload.data ?? payload,
      occurredAt: payload.metadata?.publishDate ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    topic: string,
    callbackUrl: string,
  ): Promise<void> {
    const creds = credentials as any;
    const topicMap: Record<string, string> = {
      'product.updated': 'commerce.inventory.item.updated',
      'order.created': 'commerce.sell.order.created',
      'order.updated': 'commerce.sell.order.updated',
      'inventory.updated': 'commerce.inventory.item.updated',
    };

    await this.ebayFetch(
      '/commerce/notification/v1/subscription',
      creds.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          topicId: topicMap[topic] ?? topic,
          status: 'ENABLED',
          payload: {
            deliveryConfig: {
              endpoint: { url: callbackUrl },
            },
          },
        }),
      },
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    // eBay allows 5000 calls per day for most APIs -- ~3.5 per minute.
    // Individual API rate limits vary.
    return { requestsPerSecond: 5, burstLimit: 25 };
  }
}
