import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { PrismaService } from './modules/prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { PlatformModule } from './modules/platforms/platform.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { SyncModule } from './modules/sync/sync.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { EventsModule } from './gateways/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host', 'localhost'),
          port: configService.get<number>('redis.port', 6379),
          password: configService.get<string>('redis.password') || undefined,
          tls: configService.get('redis.tls') || undefined,
        },
      }),
      inject: [ConfigService],
    }),

    ScheduleModule.forRoot(),

    AuthModule,
    TenantsModule,
    PlatformModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
    PricingModule,
    WebhooksModule,
    SyncModule,
    AnalyticsModule,
    OnboardingModule,
    AiAssistantModule,
    EventsModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
