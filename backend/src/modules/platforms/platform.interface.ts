/**
 * Core Platform Adapter interfaces and normalized types for Linker Pro.
 *
 * Every marketplace integration implements `PlatformAdapter` so the rest
 * of the application can work with a single, platform-agnostic contract.
 */

// Re-export Prisma's PlatformType so every module uses a single source of truth.
import { PlatformType as _PlatformType } from '@prisma/client';
export { PlatformType } from '@prisma/client';
type PlatformType = _PlatformType;

export type AuthType = 'oauth2' | 'api_key' | 'basic' | 'bearer' | 'custom';

// ────────────────────────────────────────────────────────────────────────────
// Credentials – platform-specific, stored as JSON in PlatformConnection
// ────────────────────────────────────────────────────────────────────────────

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO-8601
  tokenType?: string;
  scope?: string;
  /** Platform-specific extras (e.g. Shopify store domain, Amazon marketplace id) */
  [extra: string]: unknown;
}

export interface ApiKeyCredentials {
  apiKey: string;
  apiSecret?: string;
  /** Platform-specific extras (e.g. WooCommerce store URL) */
  [extra: string]: unknown;
}

export type PlatformCredentials = OAuthCredentials | ApiKeyCredentials | Record<string, unknown>;

// ────────────────────────────────────────────────────────────────────────────
// Pagination
// ────────────────────────────────────────────────────────────────────────────

export interface PaginationCursor {
  /** Opaque cursor string returned by the adapter and fed back on the next call. */
  cursor?: string;
  /** Fallback numeric page (1-based). */
  page?: number;
  /** Items per page (adapter may cap). */
  limit?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalized Product
// ────────────────────────────────────────────────────────────────────────────

export interface PlatformImage {
  url: string;
  /** Unique id on the remote platform. */
  platformImageId?: string;
  position?: number;
  width?: number;
  height?: number;
  altText?: string;
}

export interface NormalizedVariant {
  platformVariantId: string;
  sku?: string;
  barcode?: string;
  title?: string;
  options: Record<string, string>;
  price: number;
  currency: string;
  compareAtPrice?: number;
  costPrice?: number;
  weightGrams?: number;
  stockQuantity?: number;
  images?: PlatformImage[];
}

export interface NormalizedProduct {
  platformProductId: string;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  tags?: string[];
  images: PlatformImage[];
  variants: NormalizedVariant[];
  status: 'active' | 'draft' | 'archived';
  platformUrl?: string;
  platformData?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalized Order
// ────────────────────────────────────────────────────────────────────────────

export interface NormalizedOrderItem {
  platformLineItemId?: string;
  sku?: string;
  title?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface NormalizedAddress {
  name?: string;
  company?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
}

export interface NormalizedCustomer {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface NormalizedOrder {
  platformOrderId: string;
  status: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  shippingTotal: number;
  grandTotal: number;
  customer?: NormalizedCustomer;
  shippingAddress?: NormalizedAddress;
  items: NormalizedOrderItem[];
  placedAt: Date;
  platformData?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalized Webhook Event
// ────────────────────────────────────────────────────────────────────────────

export type WebhookTopic =
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'order.created'
  | 'order.updated'
  | 'order.cancelled'
  | 'inventory.updated'
  | 'app.uninstalled'
  | string; // Allow platform-specific topics

export interface NormalizedWebhookEvent {
  /** Canonical topic string from the `WebhookTopic` type. */
  topic: WebhookTopic;
  /** Platform's own topic string. */
  platformTopic: string;
  /** Unique event / delivery id supplied by the platform. */
  idempotencyKey: string;
  /** Fully parsed payload body. */
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp of the event as reported by the platform. */
  occurredAt?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Rate-Limit Config
// ────────────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Sustained requests per second. */
  requestsPerSecond: number;
  /** Maximum burst requests allowed before throttling kicks in. */
  burstLimit: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Push / Update payloads
// ────────────────────────────────────────────────────────────────────────────

export interface PushProductPayload {
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  tags?: string[];
  images?: PlatformImage[];
  variants: {
    sku: string;
    barcode?: string;
    title?: string;
    options?: Record<string, string>;
    price: number;
    currency: string;
    compareAtPrice?: number;
    weightGrams?: number;
    stockQuantity?: number;
  }[];
}

export interface ListingChanges {
  title?: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  tags?: string[];
  images?: PlatformImage[];
  status?: 'active' | 'draft' | 'archived';
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Auth callback result
// ────────────────────────────────────────────────────────────────────────────

export interface AuthCallbackResult {
  credentials: PlatformCredentials;
  shopId: string;
  shopName: string;
}

// ────────────────────────────────────────────────────────────────────────────
// The Adapter Contract
// ────────────────────────────────────────────────────────────────────────────

export interface PlatformAdapter {
  /** Prisma enum value. */
  readonly platformKey: PlatformType;
  /** Human-readable display name (e.g. "Shopify"). */
  readonly displayName: string;
  /** CDN URL for the platform logo. */
  readonly logoUrl: string;
  /** Authentication strategy used by this platform. */
  readonly authType: AuthType;

  // ── Auth ────────────────────────────────────────────────────────────────
  /** Build the OAuth / auth redirect URL for a tenant. */
  getAuthUrl(tenantId: string, redirectUri: string): string;
  /** Exchange the auth callback code for credentials. */
  handleAuthCallback(code: string, state: string): Promise<AuthCallbackResult>;
  /** Refresh an expired credential set; returns new credentials. */
  refreshCredentials(credentials: PlatformCredentials): Promise<PlatformCredentials>;

  // ── Catalog ─────────────────────────────────────────────────────────────
  pullProducts(
    credentials: PlatformCredentials,
    pagination?: PaginationCursor,
  ): Promise<{ products: NormalizedProduct[]; nextCursor?: string }>;

  pullProductImages(
    credentials: PlatformCredentials,
    productId: string,
  ): Promise<PlatformImage[]>;

  pushProduct(
    credentials: PlatformCredentials,
    product: PushProductPayload,
  ): Promise<{ platformProductId: string; platformVariantIds: string[] }>;

  updateListing(
    credentials: PlatformCredentials,
    platformProductId: string,
    changes: ListingChanges,
  ): Promise<void>;

  // ── Inventory ───────────────────────────────────────────────────────────
  pullStock(credentials: PlatformCredentials, sku: string): Promise<number>;
  pushStock(credentials: PlatformCredentials, sku: string, quantity: number): Promise<void>;

  // ── Orders ──────────────────────────────────────────────────────────────
  pullOrders(credentials: PlatformCredentials, since: Date): Promise<NormalizedOrder[]>;

  // ── Webhooks ────────────────────────────────────────────────────────────
  verifyWebhookSignature(
    headers: Record<string, string>,
    body: string | Buffer,
    secret: string,
  ): boolean;

  parseWebhookEvent(
    headers: Record<string, string>,
    body: string | Buffer,
  ): NormalizedWebhookEvent;

  registerWebhook(
    credentials: PlatformCredentials,
    topic: WebhookTopic,
    callbackUrl: string,
  ): Promise<void>;

  // ── Rate Limiting ───────────────────────────────────────────────────────
  getRateLimitConfig(): RateLimitConfig;
}
