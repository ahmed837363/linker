export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },

  frontend: {
    url: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  },

  webhook: {
    baseUrl: process.env.WEBHOOK_BASE_URL,
  },

  platforms: {
    shopify: {
      clientId: process.env.SHOPIFY_CLIENT_ID ?? '',
      clientSecret: process.env.SHOPIFY_CLIENT_SECRET ?? '',
      scopes: process.env.SHOPIFY_SCOPES ?? 'read_products,write_products,read_inventory,write_inventory,read_orders',
    },
    salla: {
      clientId: process.env.SALLA_CLIENT_ID ?? '',
      clientSecret: process.env.SALLA_CLIENT_SECRET ?? '',
    },
    amazon: {
      clientId: process.env.AMAZON_CLIENT_ID ?? '',
      clientSecret: process.env.AMAZON_CLIENT_SECRET ?? '',
      iamArn: process.env.AMAZON_IAM_ARN ?? '',
    },
    zid: {
      clientId: process.env.ZID_CLIENT_ID ?? '',
      clientSecret: process.env.ZID_CLIENT_SECRET ?? '',
    },
    tiktokShop: {
      appKey: process.env.TIKTOK_APP_KEY ?? '',
      appSecret: process.env.TIKTOK_APP_SECRET ?? '',
    },
    ebay: {
      clientId: process.env.EBAY_CLIENT_ID ?? '',
      clientSecret: process.env.EBAY_CLIENT_SECRET ?? '',
    },
    etsy: {
      apiKey: process.env.ETSY_API_KEY ?? '',
      sharedSecret: process.env.ETSY_SHARED_SECRET ?? '',
    },
    walmart: {
      clientId: process.env.WALMART_CLIENT_ID ?? '',
      clientSecret: process.env.WALMART_CLIENT_SECRET ?? '',
    },
    mercadolibre: {
      clientId: process.env.MERCADOLIBRE_CLIENT_ID ?? '',
      clientSecret: process.env.MERCADOLIBRE_CLIENT_SECRET ?? '',
    },
    aliexpress: {
      appKey: process.env.ALIEXPRESS_APP_KEY ?? '',
      appSecret: process.env.ALIEXPRESS_APP_SECRET ?? '',
    },
  },
});
