import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { InventorySyncProcessor } from './processors/inventory-sync.processor';
import { ProductSyncProcessor } from './processors/product-sync.processor';
import { OrderSyncProcessor } from './processors/order-sync.processor';
import { TokenRefreshProcessor } from './processors/token-refresh.processor';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';

/**
 * Orchestrates all synchronisation jobs between the local database and
 * connected marketplace platforms.
 *
 * Queues:
 *  - inventory-sync  : Push stock levels to platforms
 *  - product-sync    : Push / update product listings
 *  - order-sync      : Pull orders from platforms
 *  - token-refresh   : Proactively refresh expiring OAuth tokens
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'inventory-sync' },
      { name: 'product-sync' },
      { name: 'order-sync' },
      { name: 'token-refresh' },
    ),
  ],
  controllers: [SyncController],
  providers: [
    SyncService,
    InventorySyncProcessor,
    ProductSyncProcessor,
    OrderSyncProcessor,
    TokenRefreshProcessor,
    PrismaService,
    PlatformRegistry,
  ],
  exports: [SyncService],
})
export class SyncModule {}
