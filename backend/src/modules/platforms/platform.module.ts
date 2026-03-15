import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlatformRegistry, PLATFORM_ADAPTERS } from './platform.registry';

// ── Adapter Imports ───────────────────────────────────────────────────────
import { ShopifyAdapter } from './adapters/shopify.adapter';
import { SallaAdapter } from './adapters/salla.adapter';
import { WooCommerceAdapter } from './adapters/woocommerce.adapter';
import { AmazonAdapter } from './adapters/amazon.adapter';
import { NoonAdapter } from './adapters/noon.adapter';
import { ZidAdapter } from './adapters/zid.adapter';
import { TikTokShopAdapter } from './adapters/tiktok-shop.adapter';
import { EbayAdapter } from './adapters/ebay.adapter';
import { EtsyAdapter } from './adapters/etsy.adapter';
import { WalmartAdapter } from './adapters/walmart.adapter';
import { MercadoLibreAdapter } from './adapters/mercadolibre.adapter';
import { AliExpressAdapter } from './adapters/aliexpress.adapter';
import { MagentoAdapter } from './adapters/magento.adapter';

/**
 * All concrete adapter classes. They are registered as NestJS providers
 * both under their own class token (for direct injection) and aggregated
 * under the `PLATFORM_ADAPTERS` token so the `PlatformRegistry` can
 * iterate over them.
 */
const ADAPTER_CLASSES = [
  ShopifyAdapter,
  SallaAdapter,
  WooCommerceAdapter,
  AmazonAdapter,
  NoonAdapter,
  ZidAdapter,
  TikTokShopAdapter,
  EbayAdapter,
  EtsyAdapter,
  WalmartAdapter,
  MercadoLibreAdapter,
  AliExpressAdapter,
  MagentoAdapter,
];

@Module({
  imports: [ConfigModule],
  providers: [
    // Register each adapter as its own provider (enables direct DI)
    ...ADAPTER_CLASSES,

    // Aggregate all adapters into a single array provider for the registry
    {
      provide: PLATFORM_ADAPTERS,
      useFactory: (...adapters: InstanceType<(typeof ADAPTER_CLASSES)[number]>[]) => adapters,
      inject: ADAPTER_CLASSES,
    },

    // The registry itself
    PlatformRegistry,
  ],
  exports: [
    PlatformRegistry,
    // Also export individual adapters in case a module needs direct access
    ...ADAPTER_CLASSES,
  ],
})
export class PlatformModule {}
