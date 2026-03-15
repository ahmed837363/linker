// ── Public API ────────────────────────────────────────────────────────────
export { PlatformModule } from './platform.module';
export { PlatformRegistry, PLATFORM_ADAPTERS } from './platform.registry';
export {
  PlatformAdapter,
  PlatformType,
  AuthType,
  PlatformCredentials,
  OAuthCredentials,
  ApiKeyCredentials,
  PaginationCursor,
  PlatformImage,
  NormalizedProduct,
  NormalizedVariant,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedAddress,
  NormalizedCustomer,
  NormalizedWebhookEvent,
  WebhookTopic,
  RateLimitConfig,
  PushProductPayload,
  ListingChanges,
  AuthCallbackResult,
} from './platform.interface';

// ── Adapter re-exports ───────────────────────────────────────────────────
export { ShopifyAdapter } from './adapters/shopify.adapter';
export { SallaAdapter } from './adapters/salla.adapter';
export { WooCommerceAdapter } from './adapters/woocommerce.adapter';
export { AmazonAdapter } from './adapters/amazon.adapter';
export { NoonAdapter } from './adapters/noon.adapter';
export { ZidAdapter } from './adapters/zid.adapter';
export { TikTokShopAdapter } from './adapters/tiktok-shop.adapter';
export { EbayAdapter } from './adapters/ebay.adapter';
export { EtsyAdapter } from './adapters/etsy.adapter';
export { WalmartAdapter } from './adapters/walmart.adapter';
export { MercadoLibreAdapter } from './adapters/mercadolibre.adapter';
export { AliExpressAdapter } from './adapters/aliexpress.adapter';
export { MagentoAdapter } from './adapters/magento.adapter';
