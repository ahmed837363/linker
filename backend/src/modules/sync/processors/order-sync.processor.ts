import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { PlatformRegistry } from '../../platforms/platform.registry';
import {
  PlatformType,
  PlatformCredentials,
  NormalizedOrder,
} from '../../platforms/platform.interface';

/** Data shape for order-sync jobs. */
interface OrderSyncJobData {
  syncJobId: string;
  tenantId: string;
  connectionId: string;
  fullImport?: boolean;
}

/**
 * BullMQ worker for the `order-sync` queue.
 *
 * Pulls recent orders from a platform via the adapter, creates or updates
 * local Order records, and matches line items to product variants.
 */
@Processor('order-sync')
export class OrderSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderSyncProcessor.name);

  /** Default lookback window for incremental pulls (24 hours). */
  private readonly INCREMENTAL_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
  /** Lookback window for full imports (90 days). */
  private readonly FULL_IMPORT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {
    super();
  }

  async process(job: Job<OrderSyncJobData>): Promise<void> {
    const { syncJobId, tenantId, connectionId, fullImport } = job.data;

    this.logger.log(
      `Pulling orders from connection ${connectionId} (fullImport=${!!fullImport})`,
    );

    // Mark SyncJob as in-progress
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    try {
      // ── 1. Load connection ────────────────────────────────────────────
      const connection = await this.prisma.platformConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection || connection.status !== 'active') {
        throw new Error(`Connection ${connectionId} is not active`);
      }

      const credentials = connection.credentials as PlatformCredentials;
      const adapter = this.platformRegistry.resolve(connection.platform);

      // ── 2. Determine the "since" date ─────────────────────────────────
      const lookback = fullImport
        ? this.FULL_IMPORT_LOOKBACK_MS
        : this.INCREMENTAL_LOOKBACK_MS;

      const since = connection.lastSyncedAt
        ? new Date(connection.lastSyncedAt.getTime() - 60_000) // 1-min overlap for safety
        : new Date(Date.now() - lookback);

      // ── 3. Pull orders from platform ──────────────────────────────────
      const orders: NormalizedOrder[] = await adapter.pullOrders(
        credentials,
        since,
      );

      this.logger.log(
        `Pulled ${orders.length} orders from ${connection.platform} since ${since.toISOString()}`,
      );

      let created = 0;
      let updated = 0;
      const errors: { platformOrderId: string; message: string }[] = [];

      // ── 4. Upsert each order ──────────────────────────────────────────
      for (const normalizedOrder of orders) {
        try {
          const result = await this.upsertOrder(
            tenantId,
            connectionId,
            connection.platform,
            normalizedOrder,
          );
          if (result === 'created') created++;
          else updated++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push({
            platformOrderId: normalizedOrder.platformOrderId,
            message: msg,
          });
          this.logger.warn(
            `Failed to upsert order ${normalizedOrder.platformOrderId}: ${msg}`,
          );
        }
      }

      // ── 5. Update connection last sync timestamp ──────────────────────
      await this.prisma.platformConnection.update({
        where: { id: connectionId },
        data: { lastSyncedAt: new Date() },
      });

      // ── 6. Complete SyncJob ───────────────────────────────────────────
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: errors.length > 0 ? 'completed_with_errors' : 'completed',
          completedAt: new Date(),
          progress: {
            total: orders.length,
            completed: created + updated,
            created,
            updated,
            errors: errors.length,
          },
          errorLog: errors.length > 0 ? errors : [],
        },
      });

      this.logger.log(
        `Order sync completed: ${created} created, ${updated} updated, ${errors.length} errors`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorLog: [{ timestamp: new Date().toISOString(), message }],
        },
      });

      this.logger.error(`Order sync failed: ${message}`, (error as Error).stack);
      throw error;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Upsert a single order and its line items. Returns 'created' or 'updated'.
   */
  private async upsertOrder(
    tenantId: string,
    connectionId: string,
    platform: PlatformType,
    order: NormalizedOrder,
  ): Promise<'created' | 'updated'> {
    const existing = await this.prisma.order.findUnique({
      where: {
        connectionId_platformOrderId: {
          connectionId,
          platformOrderId: order.platformOrderId,
        },
      },
    });

    if (existing) {
      // Update status and totals
      await this.prisma.order.update({
        where: { id: existing.id },
        data: {
          status: order.status,
          subtotal: order.subtotal,
          taxTotal: order.taxTotal,
          shippingTotal: order.shippingTotal,
          grandTotal: order.grandTotal,
          customer: order.customer as any ?? existing.customer,
          shippingAddress: order.shippingAddress as any ?? existing.shippingAddress,
          updatedAt: new Date(),
        },
      });
      return 'updated';
    }

    // Create new order
    const createdOrder = await this.prisma.order.create({
      data: {
        tenantId,
        connectionId,
        platform,
        platformOrderId: order.platformOrderId,
        status: order.status,
        currency: order.currency,
        subtotal: order.subtotal,
        taxTotal: order.taxTotal,
        shippingTotal: order.shippingTotal,
        grandTotal: order.grandTotal,
        customer: order.customer as any ?? null,
        shippingAddress: order.shippingAddress as any ?? null,
        placedAt: order.placedAt,
      },
    });

    // Create line items, attempting to match variants by SKU
    for (const item of order.items) {
      let variantId: string | null = null;

      if (item.sku) {
        const variant = await this.prisma.productVariant.findUnique({
          where: { tenantId_sku: { tenantId, sku: item.sku } },
        });
        variantId = variant?.id ?? null;
      }

      await this.prisma.orderItem.create({
        data: {
          orderId: createdOrder.id,
          variantId,
          platformSku: item.sku,
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        },
      });
    }

    return 'created';
  }
}
