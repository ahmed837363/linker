import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { PlatformRegistry } from '../../platforms/platform.registry';
import { PlatformType, PlatformCredentials } from '../../platforms/platform.interface';

/** Data shape for inventory-sync jobs. */
interface InventorySyncJobData {
  syncJobId: string;
  tenantId: string;
  variantId: string;
  platform: string;
  connectionId: string;
}

/**
 * BullMQ worker for the `inventory-sync` queue.
 *
 * Reads the current stock level from the database, resolves the platform
 * adapter, and pushes the quantity via `pushStock()`. If the platform
 * returns a 429 (rate limit), the job is re-enqueued with delay.
 */
@Processor('inventory-sync')
export class InventorySyncProcessor extends WorkerHost {
  private readonly logger = new Logger(InventorySyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {
    super();
  }

  async process(job: Job<InventorySyncJobData>): Promise<void> {
    const { syncJobId, tenantId, variantId, platform, connectionId } = job.data;

    this.logger.log(
      `Processing inventory push: variant=${variantId} platform=${platform} connection=${connectionId}`,
    );

    // Mark the SyncJob as in-progress
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    try {
      // ── 1. Read current stock from DB ─────────────────────────────────
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: variantId, tenantId },
      });

      if (!variant) {
        throw new Error(`Variant ${variantId} not found for tenant ${tenantId}`);
      }

      // ── 2. Resolve the platform listing to get the SKU mapping ────────
      const listing = await this.prisma.platformListing.findFirst({
        where: {
          variantId,
          connectionId,
          tenantId,
        },
      });

      if (!listing) {
        throw new Error(
          `No platform listing found for variant ${variantId} on connection ${connectionId}`,
        );
      }

      const sku = listing.platformSku ?? variant.sku;

      // ── 3. Load connection credentials ────────────────────────────────
      const connection = await this.prisma.platformConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection || connection.status !== 'active') {
        throw new Error(
          `Connection ${connectionId} is not active (status: ${connection?.status ?? 'not found'})`,
        );
      }

      const credentials = connection.credentials as PlatformCredentials;

      // ── 4. Push stock via adapter ─────────────────────────────────────
      const adapter = this.platformRegistry.resolve(platform as PlatformType);
      await adapter.pushStock(credentials, sku, variant.stockQuantity);

      // ── 5. Update listing metadata ────────────────────────────────────
      await this.prisma.platformListing.update({
        where: { id: listing.id },
        data: { lastPushedAt: new Date() },
      });

      // ── 6. Mark SyncJob as completed ──────────────────────────────────
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: { total: 1, completed: 1 },
        },
      });

      this.logger.log(
        `Inventory push completed: SKU=${sku} quantity=${variant.stockQuantity} -> ${platform}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // ── Handle rate limiting (429) ──────────────────────────────────────
      if (this.isRateLimitError(error)) {
        const retryAfter = this.extractRetryAfter(error);
        this.logger.warn(
          `Rate limited by ${platform}. Re-enqueuing with ${retryAfter}ms delay.`,
        );

        // Move the job back with a delay instead of counting it as a failure
        await job.moveToDelayed(Date.now() + retryAfter, job.token);
        // Update sync job to reflect the delay
        await this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: { status: 'queued' },
        });
        return;
      }

      // ── Mark SyncJob as failed ──────────────────────────────────────────
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorLog: [{ timestamp: new Date().toISOString(), message }],
        },
      });

      this.logger.error(`Inventory push failed: ${message}`, (error as Error).stack);
      throw error;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Detect a 429 / rate-limit response from the platform adapter. */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('too many requests') ||
        (error as any).status === 429
      );
    }
    return false;
  }

  /**
   * Extract the Retry-After value in milliseconds. Falls back to 30 seconds.
   */
  private extractRetryAfter(error: unknown): number {
    const DEFAULT_RETRY_MS = 30_000;

    if (error instanceof Error) {
      const retryAfter = (error as any).retryAfter;
      if (typeof retryAfter === 'number') {
        // If less than 300 it is probably seconds; otherwise ms
        return retryAfter < 300 ? retryAfter * 1_000 : retryAfter;
      }
    }

    return DEFAULT_RETRY_MS;
  }
}
