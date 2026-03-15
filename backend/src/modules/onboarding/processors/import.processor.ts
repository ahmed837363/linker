import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';

import { PrismaService } from '../../prisma.service';
import { PlatformRegistry } from '../../platforms/platform.registry';
import { PlatformType as AdapterPlatformType } from '../../platforms/platform.interface';

export interface ImportJobData {
  sessionId: string;
  tenantId: string;
  connectionId: string;
  platform: string;
}

@Processor('onboarding:import')
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
    @InjectQueue('onboarding:embed')
    private readonly embedQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const { sessionId, tenantId, connectionId, platform } = job.data;

    this.logger.log(
      `Starting product import for connection ${connectionId} (${platform}) ` +
        `in session ${sessionId}`,
    );

    try {
      // Resolve the platform adapter
      const adapter = this.platformRegistry.resolve(
        platform as AdapterPlatformType,
      );

      // Load connection credentials
      const connection =
        await this.prisma.platformConnection.findUniqueOrThrow({
          where: { id: connectionId },
        });

      const credentials = connection.credentials as Record<string, unknown>;

      // Pull all products via paginated API calls
      let cursor: string | undefined;
      let totalImported = 0;

      do {
        const result = await adapter.pullProducts(credentials, {
          cursor,
          limit: 100,
        });

        if (result.products.length === 0) break;

        // Map normalised products to OnboardingProduct records
        const createOps = result.products.map((product) => {
          const primaryVariant = product.variants[0];
          const imageUrls = product.images.map((img) => img.url);

          // Build attributes from variant options + tags
          const attributes: Record<string, string> = {};
          if (product.brand) attributes['brand'] = product.brand;
          if (product.category) attributes['category'] = product.category;
          if (product.tags) attributes['tags'] = product.tags.join(', ');
          if (primaryVariant?.options) {
            Object.assign(attributes, primaryVariant.options);
          }

          return this.prisma.onboardingProduct.create({
            data: {
              sessionId,
              connectionId,
              platform: platform as any,
              platformProductId: product.platformProductId,
              title: product.title,
              description: product.description ?? null,
              price: primaryVariant?.price ?? null,
              currency: primaryVariant?.currency ?? null,
              sku: primaryVariant?.sku ?? null,
              barcode: primaryVariant?.barcode ?? null,
              imageUrls,
              attributes,
            },
          });
        });

        await this.prisma.$transaction(createOps);
        totalImported += result.products.length;

        await job.updateProgress(totalImported);

        cursor = result.nextCursor;
      } while (cursor);

      this.logger.log(
        `Import complete for connection ${connectionId}: ${totalImported} products`,
      );

      // Check if all import jobs for this session are done
      await this.checkAndAdvance(sessionId);
    } catch (error) {
      this.logger.error(
        `Import failed for connection ${connectionId} in session ${sessionId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      throw error;
    }
  }

  /**
   * Once all connections' imports are complete, enqueue the embed job.
   * We determine "all done" by checking whether any other import jobs
   * for this session are still active.
   */
  private async checkAndAdvance(sessionId: string): Promise<void> {
    // Count onboarding products grouped by connection to verify all imports ran
    const session =
      await this.prisma.onboardingSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { onboardingProducts: { select: { connectionId: true } } },
      });

    // Retrieve how many connections the tenant has
    const connectionCount = await this.prisma.platformConnection.count({
      where: { tenantId: session.tenantId, status: 'active' },
    });

    const importedConnections = new Set(
      session.onboardingProducts.map((p) => p.connectionId),
    );

    if (importedConnections.size >= connectionCount) {
      this.logger.log(
        `All imports complete for session ${sessionId}. Enqueuing embed job.`,
      );

      await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { status: 'embedding' },
      });

      await this.embedQueue.add('embed', { sessionId });
    }
  }
}
