import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Injectable, Optional, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';
import { PlatformType, NormalizedWebhookEvent } from '../platforms/platform.interface';

// ── Cross-module dependency tokens ──────────────────────────────────────────
// These are satisfied when the respective modules provide them.
// The processor degrades gracefully if they are not yet wired up.

export const ORDERS_SERVICE = Symbol('ORDERS_SERVICE');
export const INVENTORY_SERVICE = Symbol('INVENTORY_SERVICE');

export interface IOrdersService {
  createFromWebhook(
    tenantId: string,
    connectionId: string,
    orderData: Record<string, unknown>,
  ): Promise<any>;
}

export interface IInventoryService {
  adjustStock(
    tenantId: string,
    variantId: string,
    newQuantity: number,
  ): Promise<void>;
  syncStockToPlatforms(
    tenantId: string,
    variantId: string,
  ): Promise<void>;
}

/** Data shape pushed into the 'webhook-processing' queue. */
interface WebhookJobData {
  webhookEventId: string;
  connectionId: string;
  tenantId: string;
  platform: string;
  isReplay?: boolean;
}

/**
 * BullMQ worker for the `webhook-processing` queue.
 *
 * Responsibilities:
 * 1. Deduplicates by idempotency key (skips already-processed events).
 * 2. Parses the raw event through the platform adapter.
 * 3. Dispatches to the appropriate domain handler based on event type.
 * 4. Updates the WebhookEvent status to 'processed' or 'failed'.
 */
@Processor('webhook-processing')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
    @Optional() @Inject(ORDERS_SERVICE)
    private readonly ordersService?: IOrdersService,
    @Optional() @Inject(INVENTORY_SERVICE)
    private readonly inventoryService?: IInventoryService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, connectionId, tenantId, platform } = job.data;

    this.logger.log(
      `Processing webhook event ${webhookEventId} for ${platform}/${connectionId}`,
    );

    // ── 1. Load the stored event ──────────────────────────────────────────
    const webhookEvent = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });

    if (!webhookEvent) {
      this.logger.warn(`WebhookEvent ${webhookEventId} not found -- skipping`);
      return;
    }

    // ── 1b. Deduplicate by idempotency key ────────────────────────────────
    if (webhookEvent.status === 'processed' && !job.data.isReplay) {
      this.logger.debug(
        `WebhookEvent ${webhookEventId} already processed (idempotency key: ${webhookEvent.idempotencyKey}) -- skipping`,
      );
      return;
    }

    try {
      // ── 2. Parse event through platform adapter ─────────────────────────
      const adapter = this.platformRegistry.resolve(platform as PlatformType);

      const headers = (webhookEvent.headers ?? {}) as Record<string, string>;
      const rawPayload = JSON.stringify(webhookEvent.payload);

      const parsed: NormalizedWebhookEvent = adapter.parseWebhookEvent(
        headers,
        rawPayload,
      );

      this.logger.log(
        `Parsed webhook event: topic=${parsed.topic} platformTopic=${parsed.platformTopic}`,
      );

      // ── 3. Dispatch based on event type ─────────────────────────────────
      await this.dispatch(parsed, tenantId, connectionId);

      // ── 4. Mark as processed ────────────────────────────────────────────
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'processed',
          eventType: parsed.topic,
          processedAt: new Date(),
          errorMessage: null,
        },
      });

      this.logger.log(`WebhookEvent ${webhookEventId} processed successfully`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to process webhook event ${webhookEventId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      // ── 4b. Mark as failed ──────────────────────────────────────────────
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'failed',
          errorMessage: message,
          processedAt: new Date(),
        },
      });

      // Re-throw so BullMQ respects the retry strategy
      throw error;
    }
  }

  // ── Dispatch Logic ──────────────────────────────────────────────────────

  private async dispatch(
    event: NormalizedWebhookEvent,
    tenantId: string,
    connectionId: string,
  ): Promise<void> {
    switch (event.topic) {
      case 'order.created':
        await this.handleOrderCreated(tenantId, connectionId, event);
        break;

      case 'order.updated':
        await this.handleOrderUpdated(tenantId, connectionId, event);
        break;

      case 'order.cancelled':
        await this.handleOrderUpdated(tenantId, connectionId, event);
        break;

      case 'inventory.updated':
        await this.handleInventoryUpdated(tenantId, connectionId, event);
        break;

      case 'product.updated':
        await this.handleProductUpdated(tenantId, connectionId, event);
        break;

      case 'product.created':
        await this.handleProductUpdated(tenantId, connectionId, event);
        break;

      case 'product.deleted':
        await this.handleProductDeleted(tenantId, connectionId, event);
        break;

      case 'app.uninstalled':
        await this.handleAppUninstalled(tenantId, connectionId);
        break;

      default:
        this.logger.warn(`Unhandled webhook topic: ${event.topic}`);
    }
  }

  // ── Order handlers ────────────────────────────────────────────────────────

  private async handleOrderCreated(
    tenantId: string,
    connectionId: string,
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    if (this.ordersService) {
      await this.ordersService.createFromWebhook(
        tenantId,
        connectionId,
        event.payload,
      );
      return;
    }

    // Fallback: create order directly via Prisma
    const payload = event.payload;
    const platformOrderId = (payload.platformOrderId as string) ?? event.idempotencyKey;

    const connection = await this.prisma.platformConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) return;

    // Upsert to avoid duplicates
    await this.prisma.order.upsert({
      where: {
        connectionId_platformOrderId: {
          connectionId,
          platformOrderId,
        },
      },
      update: {
        status: (payload.status as string) ?? 'new',
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        connectionId,
        platform: connection.platform,
        platformOrderId,
        status: (payload.status as string) ?? 'new',
        currency: (payload.currency as string) ?? 'USD',
        subtotal: Number(payload.subtotal ?? 0),
        taxTotal: Number(payload.taxTotal ?? 0),
        shippingTotal: Number(payload.shippingTotal ?? 0),
        grandTotal: Number(payload.grandTotal ?? 0),
        customer: (payload.customer as object) ?? null,
        shippingAddress: (payload.shippingAddress as object) ?? null,
        placedAt: payload.placedAt
          ? new Date(payload.placedAt as string)
          : new Date(),
      },
    });

    this.logger.log(
      `Order ${platformOrderId} created/updated for tenant ${tenantId}`,
    );
  }

  private async handleOrderUpdated(
    tenantId: string,
    connectionId: string,
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    const payload = event.payload;
    const platformOrderId = payload.platformOrderId as string;

    if (!platformOrderId) {
      this.logger.warn('order.updated event missing platformOrderId');
      return;
    }

    const order = await this.prisma.order.findUnique({
      where: {
        connectionId_platformOrderId: {
          connectionId,
          platformOrderId,
        },
      },
    });

    if (!order) {
      this.logger.warn(
        `Order ${platformOrderId} not found for connection ${connectionId} -- creating via order.created path`,
      );
      await this.handleOrderCreated(tenantId, connectionId, event);
      return;
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: (payload.status as string) ?? order.status,
        grandTotal: payload.grandTotal
          ? Number(payload.grandTotal)
          : undefined,
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `Order ${platformOrderId} status updated to ${payload.status ?? 'unchanged'}`,
    );
  }

  // ── Inventory handler ─────────────────────────────────────────────────────

  private async handleInventoryUpdated(
    tenantId: string,
    connectionId: string,
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    const payload = event.payload;
    const sku = payload.sku as string | undefined;
    const newQuantity = payload.stockQuantity as number | undefined;

    if (!sku || newQuantity === undefined) {
      this.logger.warn('inventory.updated event missing sku or stockQuantity');
      return;
    }

    // Find the variant by SKU within this tenant
    const variant = await this.prisma.productVariant.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
    });

    if (!variant) {
      this.logger.warn(`Variant with SKU ${sku} not found for tenant ${tenantId}`);
      return;
    }

    if (this.inventoryService) {
      await this.inventoryService.adjustStock(tenantId, variant.id, newQuantity);
      await this.inventoryService.syncStockToPlatforms(tenantId, variant.id);
      return;
    }

    // Fallback: update stock directly
    await this.prisma.productVariant.update({
      where: { id: variant.id },
      data: { stockQuantity: newQuantity },
    });

    this.logger.log(
      `Inventory for SKU ${sku} updated to ${newQuantity} (tenant ${tenantId})`,
    );
  }

  // ── Product handlers ──────────────────────────────────────────────────────

  private async handleProductUpdated(
    tenantId: string,
    connectionId: string,
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    const payload = event.payload;
    const platformProductId = payload.platformProductId as string | undefined;

    if (!platformProductId) {
      this.logger.warn('product.updated event missing platformProductId');
      return;
    }

    // Update the platform listing data
    const listings = await this.prisma.platformListing.findMany({
      where: {
        connectionId,
        platformProductId,
      },
    });

    if (listings.length === 0) {
      this.logger.debug(
        `No listing found for platformProductId ${platformProductId} on connection ${connectionId}`,
      );
      return;
    }

    for (const listing of listings) {
      await this.prisma.platformListing.update({
        where: { id: listing.id },
        data: {
          platformData: payload as object,
          lastPulledAt: new Date(),
        },
      });
    }

    this.logger.log(
      `Platform listing data updated for ${platformProductId} (${listings.length} listings)`,
    );
  }

  private async handleProductDeleted(
    tenantId: string,
    connectionId: string,
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    const platformProductId = event.payload.platformProductId as string | undefined;
    if (!platformProductId) return;

    await this.prisma.platformListing.updateMany({
      where: { connectionId, platformProductId },
      data: { listingStatus: 'deleted' },
    });

    this.logger.log(
      `Listings marked as deleted for platformProductId ${platformProductId}`,
    );
  }

  // ── App uninstalled ───────────────────────────────────────────────────────

  private async handleAppUninstalled(
    tenantId: string,
    connectionId: string,
  ): Promise<void> {
    await this.prisma.platformConnection.update({
      where: { id: connectionId },
      data: { status: 'disconnected' },
    });

    this.logger.log(
      `Connection ${connectionId} marked as disconnected (app uninstalled)`,
    );
  }
}
