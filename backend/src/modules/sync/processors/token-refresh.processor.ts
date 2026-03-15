import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { PlatformRegistry } from '../../platforms/platform.registry';
import { PlatformCredentials } from '../../platforms/platform.interface';

/**
 * BullMQ worker for the `token-refresh` queue.
 *
 * Runs as a **repeatable job** (every 5 minutes). Scans all platform
 * connections whose OAuth token expires within the next 10 minutes and
 * proactively refreshes them via the adapter's `refreshCredentials()`.
 */
@Processor('token-refresh')
export class TokenRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenRefreshProcessor.name);

  /** Refresh tokens that expire within this window. */
  private readonly EXPIRY_WINDOW_MS = 10 * 60 * 1_000; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    this.logger.debug('Running token refresh sweep...');

    const expiryThreshold = new Date(Date.now() + this.EXPIRY_WINDOW_MS);

    // Find all active connections whose token expires soon
    const expiringConnections = await this.prisma.platformConnection.findMany({
      where: {
        status: 'active',
        tokenExpiresAt: {
          not: null,
          lte: expiryThreshold,
        },
      },
    });

    if (expiringConnections.length === 0) {
      this.logger.debug('No tokens expiring within window -- nothing to do');
      return;
    }

    this.logger.log(
      `Found ${expiringConnections.length} connection(s) with tokens expiring before ${expiryThreshold.toISOString()}`,
    );

    let successCount = 0;
    let failCount = 0;

    for (const connection of expiringConnections) {
      try {
        const adapter = this.platformRegistry.tryResolve(connection.platform);

        if (!adapter) {
          this.logger.warn(
            `No adapter registered for platform ${connection.platform} -- skipping connection ${connection.id}`,
          );
          continue;
        }

        const currentCredentials = connection.credentials as PlatformCredentials;
        const newCredentials = await adapter.refreshCredentials(currentCredentials);

        // Extract the new expiry if the adapter returns it
        let newExpiresAt: Date | null = null;
        if ('expiresAt' in newCredentials && newCredentials.expiresAt) {
          newExpiresAt = new Date(newCredentials.expiresAt as string);
        }

        await this.prisma.platformConnection.update({
          where: { id: connection.id },
          data: {
            credentials: newCredentials as any,
            tokenExpiresAt: newExpiresAt,
            updatedAt: new Date(),
          },
        });

        successCount++;
        this.logger.log(
          `Refreshed token for connection ${connection.id} (${connection.platform}/${connection.shopName ?? connection.platformShopId})`,
        );
      } catch (error) {
        failCount++;
        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Failed to refresh token for connection ${connection.id}: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );

        // Mark the connection as needing attention if refresh fails repeatedly
        // We do not disconnect automatically -- the user must re-authenticate
        await this.prisma.platformConnection.update({
          where: { id: connection.id },
          data: {
            status: 'token_expired',
            updatedAt: new Date(),
          },
        });
      }
    }

    this.logger.log(
      `Token refresh sweep completed: ${successCount} refreshed, ${failCount} failed`,
    );
  }
}
