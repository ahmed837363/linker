import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { PlatformRegistry } from '../../platforms/platform.registry';
import {
  PlatformType,
  PlatformCredentials,
  PushProductPayload,
} from '../../platforms/platform.interface';

/** Data shape for product-sync jobs. */
interface ProductSyncJobData {
  syncJobId: string;
  tenantId: string;
  productId?: string;
  connectionId: string;
  fullImport?: boolean;
}

/**
 * BullMQ worker for the `product-sync` queue.
 *
 * Handles two job types:
 *  - `push-product`  : Push a single product + variants to a platform.
 *  - `full-import`   : Pull the full catalog from a platform and store it.
 */
@Processor('product-sync')
export class ProductSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {
    super();
  }

  async process(job: Job<ProductSyncJobData>): Promise<void> {
    if (job.data.fullImport) {
      return this.processFullImport(job);
    }
    return this.processPushProduct(job);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Push Product
  // ────────────────────────────────────────────────────────────────────────

  private async processPushProduct(job: Job<ProductSyncJobData>): Promise<void> {
    const { syncJobId, tenantId, productId, connectionId } = job.data;

    if (!productId) {
      throw new Error('productId is required for push-product jobs');
    }

    this.logger.log(
      `Pushing product ${productId} to connection ${connectionId}`,
    );

    await this.markSyncJobInProgress(syncJobId);

    try {
      // ── 1. Read product + variants from DB ────────────────────────────
      const product = await this.prisma.product.findFirst({
        where: { id: productId, tenantId },
        include: { variants: true },
      });

      if (!product) {
        throw new Error(`Product ${productId} not found for tenant ${tenantId}`);
      }

      // ── 2. Load connection ────────────────────────────────────────────
      const connection = await this.prisma.platformConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection || connection.status !== 'active') {
        throw new Error(`Connection ${connectionId} is not active`);
      }

      const credentials = connection.credentials as PlatformCredentials;
      const adapter = this.platformRegistry.resolve(connection.platform);

      // ── 3. Transform to platform format ───────────────────────────────
      const pushPayload: PushProductPayload = {
        title: product.title,
        description: product.description ?? undefined,
        brand: product.brand ?? undefined,
        category: product.category ?? undefined,
        tags: product.tags,
        images: (product.images as any[]) ?? [],
        variants: product.variants.map((v) => ({
          sku: v.sku,
          barcode: v.barcode ?? undefined,
          title: v.title ?? undefined,
          options: (v.options as Record<string, string>) ?? {},
          price: Number(v.basePrice),
          currency: v.baseCurrency,
          compareAtPrice: v.costPrice ? Number(v.costPrice) : undefined,
          weightGrams: v.weightGrams ?? undefined,
          stockQuantity: v.stockQuantity,
        })),
      };

      // ── 4. Check if listing already exists (update vs create) ─────────
      const existingListing = await this.prisma.platformListing.findFirst({
        where: {
          productId,
          connectionId,
          tenantId,
        },
      });

      if (existingListing?.platformProductId) {
        // Update existing listing
        await adapter.updateListing(
          credentials,
          existingListing.platformProductId,
          {
            title: pushPayload.title,
            description: pushPayload.description,
            tags: pushPayload.tags,
            images: pushPayload.images,
          },
        );

        await this.prisma.platformListing.update({
          where: { id: existingListing.id },
          data: {
            listingStatus: 'active',
            lastPushedAt: new Date(),
          },
        });

        this.logger.log(
          `Updated listing for product ${productId} on ${connection.platform}`,
        );
      } else {
        // Push new product
        const result = await adapter.pushProduct(credentials, pushPayload);

        // Create PlatformListing records for each variant
        for (let i = 0; i < product.variants.length; i++) {
          const variant = product.variants[i];
          const platformVariantId = result.platformVariantIds[i] ?? null;

          await this.prisma.platformListing.upsert({
            where: {
              connectionId_platformProductId_platformVariantId: {
                connectionId,
                platformProductId: result.platformProductId,
                platformVariantId: platformVariantId ?? '',
              },
            },
            update: {
              listingStatus: 'active',
              lastPushedAt: new Date(),
            },
            create: {
              tenantId,
              productId,
              variantId: variant.id,
              connectionId,
              platform: connection.platform,
              platformProductId: result.platformProductId,
              platformVariantId,
              platformSku: variant.sku,
              listingStatus: 'active',
              lastPushedAt: new Date(),
            },
          });
        }

        this.logger.log(
          `Created listing for product ${productId} on ${connection.platform} (platformProductId=${result.platformProductId})`,
        );
      }

      // ── 5. Mark completed ─────────────────────────────────────────────
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: { total: 1, completed: 1 },
        },
      });
    } catch (error) {
      await this.failSyncJob(syncJobId, error);
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Full Catalog Import
  // ────────────────────────────────────────────────────────────────────────

  private async processFullImport(job: Job<ProductSyncJobData>): Promise<void> {
    const { syncJobId, tenantId, connectionId } = job.data;

    this.logger.log(`Starting full catalog import for connection ${connectionId}`);

    await this.markSyncJobInProgress(syncJobId);

    try {
      const connection = await this.prisma.platformConnection.findUnique({
        where: { id: connectionId },
      });

      if (!connection || connection.status !== 'active') {
        throw new Error(`Connection ${connectionId} is not active`);
      }

      const credentials = connection.credentials as PlatformCredentials;
      const adapter = this.platformRegistry.resolve(connection.platform);

      let nextCursor: string | undefined;
      let totalImported = 0;

      do {
        const page = await adapter.pullProducts(credentials, {
          cursor: nextCursor,
          limit: 50,
        });

        for (const normalizedProduct of page.products) {
          // Upsert product
          const product = await this.prisma.product.upsert({
            where: {
              // Use a composite lookup or find-first pattern
              id: await this.findProductIdByPlatformProduct(
                tenantId,
                connectionId,
                normalizedProduct.platformProductId,
              ) ?? 'non-existent-uuid',
            },
            update: {
              title: normalizedProduct.title,
              description: normalizedProduct.description,
              brand: normalizedProduct.brand,
              category: normalizedProduct.category,
              tags: normalizedProduct.tags ?? [],
              images: normalizedProduct.images as any,
              status: normalizedProduct.status,
              updatedAt: new Date(),
            },
            create: {
              tenantId,
              title: normalizedProduct.title,
              description: normalizedProduct.description,
              brand: normalizedProduct.brand,
              category: normalizedProduct.category,
              tags: normalizedProduct.tags ?? [],
              images: normalizedProduct.images as any,
              status: normalizedProduct.status,
            },
          });

          // Upsert variants and create listings
          for (const normalizedVariant of normalizedProduct.variants) {
            const sku =
              normalizedVariant.sku ??
              `${connection.platform}-${normalizedVariant.platformVariantId}`;

            const variant = await this.prisma.productVariant.upsert({
              where: { tenantId_sku: { tenantId, sku } },
              update: {
                title: normalizedVariant.title,
                barcode: normalizedVariant.barcode,
                options: normalizedVariant.options as any,
                basePrice: normalizedVariant.price,
                baseCurrency: normalizedVariant.currency,
                costPrice: normalizedVariant.costPrice,
                weightGrams: normalizedVariant.weightGrams,
                stockQuantity: normalizedVariant.stockQuantity ?? 0,
                updatedAt: new Date(),
              },
              create: {
                tenantId,
                productId: product.id,
                sku,
                barcode: normalizedVariant.barcode,
                title: normalizedVariant.title,
                options: normalizedVariant.options as any,
                basePrice: normalizedVariant.price,
                baseCurrency: normalizedVariant.currency,
                costPrice: normalizedVariant.costPrice,
                weightGrams: normalizedVariant.weightGrams,
                stockQuantity: normalizedVariant.stockQuantity ?? 0,
              },
            });

            // Upsert PlatformListing
            await this.prisma.platformListing.upsert({
              where: {
                connectionId_platformProductId_platformVariantId: {
                  connectionId,
                  platformProductId: normalizedProduct.platformProductId,
                  platformVariantId: normalizedVariant.platformVariantId,
                },
              },
              update: {
                platformSku: sku,
                platformUrl: normalizedProduct.platformUrl,
                platformData: normalizedProduct.platformData as any ?? {},
                listingStatus: normalizedProduct.status === 'active' ? 'active' : 'inactive',
                lastPulledAt: new Date(),
              },
              create: {
                tenantId,
                productId: product.id,
                variantId: variant.id,
                connectionId,
                platform: connection.platform,
                platformProductId: normalizedProduct.platformProductId,
                platformVariantId: normalizedVariant.platformVariantId,
                platformSku: sku,
                platformUrl: normalizedProduct.platformUrl,
                platformData: normalizedProduct.platformData as any ?? {},
                listingStatus: normalizedProduct.status === 'active' ? 'active' : 'inactive',
                lastPulledAt: new Date(),
              },
            });
          }

          totalImported++;
        }

        // Update progress
        await this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            progress: { total: totalImported, completed: totalImported },
          },
        });

        nextCursor = page.nextCursor;
      } while (nextCursor);

      // Update connection last synced
      await this.prisma.platformConnection.update({
        where: { id: connectionId },
        data: { lastSyncedAt: new Date() },
      });

      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: { total: totalImported, completed: totalImported },
        },
      });

      this.logger.log(
        `Full catalog import completed: ${totalImported} products from ${connection.platform}`,
      );
    } catch (error) {
      await this.failSyncJob(syncJobId, error);
      throw error;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Find an existing local product ID by its platform product ID and connection.
   */
  private async findProductIdByPlatformProduct(
    tenantId: string,
    connectionId: string,
    platformProductId: string,
  ): Promise<string | null> {
    const listing = await this.prisma.platformListing.findFirst({
      where: {
        tenantId,
        connectionId,
        platformProductId,
      },
      select: { productId: true },
    });
    return listing?.productId ?? null;
  }

  private async markSyncJobInProgress(syncJobId: string): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'in_progress', startedAt: new Date() },
    });
  }

  private async failSyncJob(syncJobId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorLog: [{ timestamp: new Date().toISOString(), message }],
      },
    });
    this.logger.error(`Product sync failed: ${message}`, (error as Error).stack);
  }
}
