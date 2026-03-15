import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';

/**
 * Central service for enqueueing and querying synchronisation jobs.
 *
 * Every public method writes a SyncJob record for audit / progress tracking
 * and adds the corresponding BullMQ job.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('inventory-sync') private readonly inventoryQueue: Queue,
    @InjectQueue('product-sync') private readonly productQueue: Queue,
    @InjectQueue('order-sync') private readonly orderQueue: Queue,
    @InjectQueue('token-refresh') private readonly tokenRefreshQueue: Queue,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // Inventory Push
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Enqueue an inventory push for a single variant to a specific platform
   * connection. Uses a composite `jobId` so that rapid-fire stock changes
   * are automatically **debounced** -- only the latest enqueuement wins.
   */
  async queueInventoryPush(
    tenantId: string,
    variantId: string,
    platform: string,
    connectionId: string,
  ) {
    const jobId = `inv-push:${tenantId}:${variantId}:${connectionId}`;

    const syncJob = await this.prisma.syncJob.create({
      data: {
        tenantId,
        connectionId,
        jobType: 'inventory-push',
        status: 'queued',
      },
    });

    await this.inventoryQueue.add(
      'push-stock',
      {
        syncJobId: syncJob.id,
        tenantId,
        variantId,
        platform,
        connectionId,
      },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 3 * 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );

    this.logger.log(
      `Inventory push queued: variant=${variantId} connection=${connectionId} (debounce key=${jobId})`,
    );

    return { syncJobId: syncJob.id, jobId };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Product Push
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Enqueue a product push / update to a specific platform connection.
   */
  async queueProductPush(
    tenantId: string,
    productId: string,
    connectionId: string,
  ) {
    const syncJob = await this.prisma.syncJob.create({
      data: {
        tenantId,
        connectionId,
        jobType: 'product-push',
        status: 'queued',
      },
    });

    await this.productQueue.add(
      'push-product',
      {
        syncJobId: syncJob.id,
        tenantId,
        productId,
        connectionId,
      },
      {
        jobId: `prod-push:${tenantId}:${productId}:${connectionId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3 * 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );

    this.logger.log(
      `Product push queued: product=${productId} connection=${connectionId}`,
    );

    return { syncJobId: syncJob.id };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Order Pull
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Enqueue a pull of recent orders from a platform connection.
   */
  async queueOrderPull(tenantId: string, connectionId: string) {
    const syncJob = await this.prisma.syncJob.create({
      data: {
        tenantId,
        connectionId,
        jobType: 'order-pull',
        status: 'queued',
      },
    });

    await this.orderQueue.add(
      'pull-orders',
      {
        syncJobId: syncJob.id,
        tenantId,
        connectionId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3 * 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );

    this.logger.log(`Order pull queued: connection=${connectionId}`);

    return { syncJobId: syncJob.id };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Full Import
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Enqueue a full catalog + order import from a platform connection.
   * This creates a product-sync job (full import mode) followed by an
   * order-sync job.
   */
  async queueFullImport(tenantId: string, connectionId: string) {
    const syncJob = await this.prisma.syncJob.create({
      data: {
        tenantId,
        connectionId,
        jobType: 'full-import',
        status: 'queued',
      },
    });

    // Catalog import
    await this.productQueue.add(
      'full-import',
      {
        syncJobId: syncJob.id,
        tenantId,
        connectionId,
        fullImport: true,
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 14 * 24 * 3600 },
      },
    );

    // Order import (after catalog so variant matching can work)
    await this.orderQueue.add(
      'pull-orders',
      {
        syncJobId: syncJob.id,
        tenantId,
        connectionId,
        fullImport: true,
      },
      {
        delay: 2_000, // slight delay to let the product import start first
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 14 * 24 * 3600 },
      },
    );

    this.logger.log(`Full import queued: connection=${connectionId}`);

    return { syncJobId: syncJob.id };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Status / Query
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get progress information for a specific sync job.
   */
  async getSyncJobStatus(tenantId: string, jobId: string) {
    const syncJob = await this.prisma.syncJob.findFirst({
      where: { id: jobId, tenantId },
      include: { connection: { select: { platform: true, shopName: true } } },
    });

    if (!syncJob) {
      throw new NotFoundException(`Sync job ${jobId} not found`);
    }

    return syncJob;
  }

  /**
   * List the most recent sync jobs for a tenant.
   */
  async getRecentJobs(
    tenantId: string,
    options?: { limit?: number; offset?: number; jobType?: string },
  ) {
    const { limit = 25, offset = 0, jobType } = options ?? {};

    const where: Record<string, unknown> = { tenantId };
    if (jobType) {
      where.jobType = jobType;
    }

    const [jobs, total] = await Promise.all([
      this.prisma.syncJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          connection: { select: { platform: true, shopName: true } },
        },
      }),
      this.prisma.syncJob.count({ where }),
    ]);

    return { jobs, total, limit, offset };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Token Refresh (setup repeatable job)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Called once at module init to ensure the repeatable token-refresh job
   * exists. Safe to call multiple times -- BullMQ deduplicates repeatables.
   */
  async ensureTokenRefreshSchedule(): Promise<void> {
    await this.tokenRefreshQueue.add(
      'refresh-expiring-tokens',
      {},
      {
        repeat: { every: 5 * 60 * 1_000 }, // every 5 minutes
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 24 * 3600 },
      },
    );

    this.logger.log('Token refresh repeatable job registered (every 5 min)');
  }
}
