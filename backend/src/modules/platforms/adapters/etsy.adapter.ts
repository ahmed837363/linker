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

const ETSY_AUTH_URL = 'https://www.etsy.com/oauth/connect';
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const ETSY_API_BASE = 'https://openapi.etsy.com/v3';

@Injectable()
export class EtsyAdapter implements PlatformAdapter {
  readonly platformKey = PlatformType.etsy;
  readonly displayName = 'Etsy';
  readonly logoUrl = 'https://www.etsy.com/images/etsy_logo_lg_rgb.png';
  readonly authType: AuthType = 'oauth2';

  private readonly logger = new Logger(EtsyAdapter.name);
  private readonly apiKeyString: string;
  private readonly sharedSecret: string;

  constructor(private readonly config: ConfigService) {
    this.apiKeyString = this.config.get<string>('ETSY_API_KEY', '');
    this.sharedSecret = this.config.get<string>('ETSY_SHARED_SECRET', '');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Etsy Open API v3 uses PKCE (S256). This generates code_verifier / code_challenge.
   */
  private generatePkce(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  private async etsyFetch<T = any>(
    path: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${ETSY_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-api-key': this.apiKeyString,
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Etsy API ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  getAuthUrl(tenantId: string, redirectUri: string): string {
    const { codeVerifier, codeChallenge } = this.generatePkce();
    // In production the codeVerifier must be stored server-side (e.g. cache / DB)
    // keyed by state so it can be used during the token exchange.
    const state = Buffer.from(
      JSON.stringify({ tenantId, codeVerifier }),
    ).toString('base64url');

    const scopes = [
      'transactions_r',
      'transactions_w',
      'listings_r',
      'listings_w',
      'listings_d',
      'shops_r',
      'shops_w',
      'profile_r',
    ].join('%20');

    return (
      `${ETSY_AUTH_URL}` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(this.apiKeyString)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scopes}` +
      `&state=${state}` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`
    );
  }

  async handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult> {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    const codeVerifier: string = parsed.codeVerifier;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.apiKeyString,
      redirect_uri: '', // must match the one used in authorize
      code,
      code_verifier: codeVerifier,
    });

    const tokenRes = await fetch(ETSY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`Etsy token exchange failed: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // Fetch shop info -- the access_token embeds the user id.
    // GET /application/users/me --> user_id
    const me = await this.etsyFetch<{ user_id: number; shop_id: number }>(
      '/application/users/me',
      token.access_token,
    );

    let shopName = 'Etsy Shop';
    let shopId = String(me.shop_id ?? me.user_id);
    try {
      const shop = await this.etsyFetch<{
        shop_id: number;
        shop_name: string;
      }>(`/application/shops/${me.shop_id ?? me.user_id}`, token.access_token);
      shopId = String(shop.shop_id);
      shopName = shop.shop_name;
    } catch {
      this.logger.warn('Could not fetch Etsy shop details');
    }

    return {
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        tokenType: token.token_type,
        shopId,
      },
      shopId,
      shopName,
    };
  }

  async refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials> {
    const creds = credentials as any;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.apiKeyString,
      refresh_token: creds.refreshToken,
    });

    const tokenRes = await fetch(ETSY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!tokenRes.ok) throw new Error(`Etsy refresh failed: ${await tokenRes.text()}`);
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
    const shopId = creds.shopId;
    const limit = pagination?.limit ?? 25;
    const offset = pagination?.cursor ? parseInt(pagination.cursor, 10) : 0;

    const res = await this.etsyFetch<{
      count: number;
      results: any[];
    }>(
      `/application/shops/${shopId}/listings?limit=${limit}&offset=${offset}&includes=images`,
      creds.accessToken,
    );

    const products: NormalizedProduct[] = (res.results ?? []).map((l: any) => ({
      platformProductId: String(l.listing_id),
      title: l.title ?? '',
      description: l.description ?? undefined,
      brand: undefined,
      category: l.taxonomy_path?.join(' > ') ?? undefined,
      tags: l.tags ?? [],
      images: (l.images ?? []).map((img: any, idx: number) => ({
        url: img.url_570xN ?? img.url_fullxfull ?? img.url_75x75,
        platformImageId: String(img.listing_image_id),
        position: img.rank ?? idx,
        width: img.full_width,
        height: img.full_height,
        altText: img.alt_text ?? undefined,
      })),
      variants: [
        {
          platformVariantId: String(l.listing_id),
          sku: l.sku?.[0] ?? undefined,
          title: l.title,
          options: {},
          price: parseFloat(l.price?.amount ?? '0') / (l.price?.divisor ?? 100),
          currency: l.price?.currency_code ?? 'USD',
          stockQuantity: l.quantity ?? 0,
        },
      ],
      status: l.state === 'active' ? 'active' : l.state === 'removed' ? 'archived' : 'draft',
      platformUrl: l.url ?? undefined,
    }));

    const nextOffset = offset + limit;
    const nextCursor = nextOffset < (res.count ?? 0) ? String(nextOffset) : undefined;
    return { products, nextCursor };
  }

  async pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]> {
    const creds = credentials as any;
    const res = await this.etsyFetch<{ count: number; results: any[] }>(
      `/application/listings/${productId}/images`,
      creds.accessToken,
    );
    return (res.results ?? []).map((img: any, idx: number) => ({
      url: img.url_570xN ?? img.url_fullxfull,
      platformImageId: String(img.listing_image_id),
      position: img.rank ?? idx,
      width: img.full_width,
      height: img.full_height,
      altText: img.alt_text ?? undefined,
    }));
  }

  async pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }> {
    const creds = credentials as any;
    const shopId = creds.shopId;
    const variant = product.variants[0];

    const body = {
      quantity: variant?.stockQuantity ?? 1,
      title: product.title,
      description: product.description ?? '',
      price: variant?.price ?? 0,
      who_made: 'i_did',
      when_made: 'made_to_order',
      taxonomy_id: 1, // Generic; caller should provide proper taxonomy
      tags: (product.tags ?? []).slice(0, 13), // Etsy max 13 tags
      sku: [variant?.sku ?? ''],
    };

    const res = await this.etsyFetch<{ listing_id: number }>(
      `/application/shops/${shopId}/listings`,
      creds.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    // Upload images
    for (const img of product.images ?? []) {
      try {
        // Image upload requires multipart form -- simplified here
        await this.etsyFetch(
          `/application/shops/${shopId}/listings/${res.listing_id}/images`,
          creds.accessToken,
          {
            method: 'POST',
            body: JSON.stringify({ url: img.url, alt_text: img.altText ?? '' }),
          },
        );
      } catch (e) {
        this.logger.warn(`Failed to upload image to Etsy listing ${res.listing_id}: ${e}`);
      }
    }

    return {
      platformProductId: String(res.listing_id),
      platformVariantIds: [String(res.listing_id)],
    };
  }

  async updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void> {
    const creds = credentials as any;
    const shopId = creds.shopId;
    const update: Record<string, unknown> = {};
    if (changes.title !== undefined) update.title = changes.title;
    if (changes.description !== undefined) update.description = changes.description;
    if (changes.price !== undefined) update.price = changes.price;
    if (changes.tags !== undefined) update.tags = changes.tags.slice(0, 13);
    if (changes.status !== undefined) {
      update.state = changes.status === 'active' ? 'active' : 'draft';
    }

    await this.etsyFetch(
      `/application/shops/${shopId}/listings/${platformProductId}`,
      creds.accessToken,
      { method: 'PATCH', body: JSON.stringify(update) },
    );
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  async pullStock(credentials: PlatformCredentials, sku: string): Promise<number> {
    const creds = credentials as any;
    const shopId = creds.shopId;
    // Etsy does not have a direct SKU search; we search active listings.
    const res = await this.etsyFetch<{ results: any[] }>(
      `/application/shops/${shopId}/listings?limit=100&state=active`,
      creds.accessToken,
    );
    const listing = (res.results ?? []).find(
      (l: any) => l.sku?.includes(sku),
    );
    if (!listing) throw new Error(`SKU "${sku}" not found on Etsy`);
    return listing.quantity ?? 0;
  }

  async pushStock(
    credentials: PlatformCredentials,
    sku: string,
    quantity: number,
  ): Promise<void> {
    const creds = credentials as any;
    const shopId = creds.shopId;
    const res = await this.etsyFetch<{ results: any[] }>(
      `/application/shops/${shopId}/listings?limit=100&state=active`,
      creds.accessToken,
    );
    const listing = (res.results ?? []).find(
      (l: any) => l.sku?.includes(sku),
    );
    if (!listing) throw new Error(`SKU "${sku}" not found on Etsy`);

    await this.etsyFetch(
      `/application/shops/${shopId}/listings/${listing.listing_id}`,
      creds.accessToken,
      { method: 'PATCH', body: JSON.stringify({ quantity }) },
    );
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  async pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]> {
    const creds = credentials as any;
    const shopId = creds.shopId;
    const minCreated = Math.floor(since.getTime() / 1000);

    const res = await this.etsyFetch<{ count: number; results: any[] }>(
      `/application/shops/${shopId}/receipts?min_created=${minCreated}&limit=100`,
      creds.accessToken,
    );

    return (res.results ?? []).map((r: any) => ({
      platformOrderId: String(r.receipt_id),
      status: r.status ?? 'unknown',
      currency: r.grandtotal?.currency_code ?? 'USD',
      subtotal: parseFloat(r.subtotal?.amount ?? '0') / (r.subtotal?.divisor ?? 100),
      taxTotal: parseFloat(r.total_tax_cost?.amount ?? '0') / (r.total_tax_cost?.divisor ?? 100),
      shippingTotal:
        parseFloat(r.total_shipping_cost?.amount ?? '0') / (r.total_shipping_cost?.divisor ?? 100),
      grandTotal: parseFloat(r.grandtotal?.amount ?? '0') / (r.grandtotal?.divisor ?? 100),
      customer: {
        email: r.buyer_email,
        firstName: r.name?.split(' ')[0],
        lastName: r.name?.split(' ').slice(1).join(' '),
      },
      shippingAddress: {
        name: r.name,
        addressLine1: r.first_line,
        addressLine2: r.second_line,
        city: r.city,
        province: r.state,
        postalCode: r.zip,
        country: r.country_iso,
      },
      items: (r.transactions ?? []).map((t: any) => ({
        platformLineItemId: String(t.transaction_id),
        sku: t.sku ?? undefined,
        title: t.title,
        quantity: t.quantity ?? 1,
        unitPrice: parseFloat(t.price?.amount ?? '0') / (t.price?.divisor ?? 100),
        totalPrice:
          (parseFloat(t.price?.amount ?? '0') / (t.price?.divisor ?? 100)) * (t.quantity ?? 1),
      })),
      placedAt: new Date((r.create_timestamp ?? 0) * 1000),
    }));
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean {
    // Etsy does not currently support push webhooks natively.
    // If using a custom proxy, verify HMAC-SHA256.
    const signature =
      headers['x-etsy-signature'] ?? headers['X-Etsy-Signature'] ?? '';
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
    const rawTopic = payload.type ?? payload.event ?? 'unknown';

    return {
      topic: rawTopic,
      platformTopic: rawTopic,
      idempotencyKey: payload.event_id ?? crypto.randomUUID(),
      payload: payload.data ?? payload,
      occurredAt: payload.timestamp ?? new Date().toISOString(),
    };
  }

  async registerWebhook(
    credentials: PlatformCredentials,
    _topic: string,
    _callbackUrl: string,
  ): Promise<void> {
    // Etsy Open API v3 does not support programmatic webhook registration.
    // Polling is the recommended approach.
    this.logger.warn(
      'Etsy does not support push webhooks. Use scheduled polling instead.',
    );
  }

  getRateLimitConfig(): RateLimitConfig {
    // Etsy Open API v3: 10 requests per second per API key.
    return { requestsPerSecond: 10, burstLimit: 30 };
  }
}
