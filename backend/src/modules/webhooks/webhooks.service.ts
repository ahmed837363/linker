import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlatformType } from '../platforms/platform.interface';

/** Shape of the data required to persist a raw webhook event. */
export interface StoreEventInput {
  connectionId: string;
  platform: PlatformType;
  eventType: string;
  idempotencyKey: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

/**
 * Manages WebhookEvent persistence and replay.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook-processing') private readonly webhookQueue: Queue,
  ) {}

  // ── Store ─────────────────────────────────────────────────────────────────

  /**
   * Persist a raw webhook event. If the idempotency key already exists the
   * existing record is returned rather than creating a duplicate.
   */
  async storeEvent(input: StoreEventInput) {
    const existing = await this.prisma.webhookEvent.findUnique({
      where: {
        platform_idempotencyKey: {
          platform: input.platform,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });

    if (existing) {
      this.logger.debug(
        `Duplicate webhook event for key ${input.idempotencyKey} -- returning existing record`,
      );
      return existing;
    }

    return this.prisma.webhookEvent.create({
      data: {
        connectionId: input.connectionId,
        platform: input.platform,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        headers: input.headers as Prisma.InputJsonValue,
        payload: input.payload as Prisma.InputJsonValue,
        status: 'received',
      },
    });
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  /**
   * List webhook events for a given connection, ordered newest-first.
   */
  async getEvents(
    connectionId: string,
    options?: { status?: string; limit?: number; offset?: number },
  ) {
    const { status, limit = 50, offset = 0 } = options ?? {};

    const where: Record<string, unknown> = { connectionId };
    if (status) {
      where.status = status;
    }

    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);

    return { events, total, limit, offset };
  }

  // ── Replay ────────────────────────────────────────────────────────────────

  /**
   * Re-enqueue a previously stored webhook event for processing.
   * Resets the event status to 'received' and clears any previous error.
   */
  async replayEvent(webhookEventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
      include: { connection: true },
    });

    if (!event) {
      throw new NotFoundException(`WebhookEvent ${webhookEventId} not found`);
    }

    // Reset status so the processor treats it as fresh
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: 'received',
        errorMessage: null,
        processedAt: null,
      },
    });

    const tenantId = event.connection?.tenantId ?? null;

    await this.webhookQueue.add(
      'process-webhook',
      {
        webhookEventId: event.id,
        connectionId: event.connectionId,
        tenantId,
        platform: event.platform,
        isReplay: true,
      },
      {
        jobId: `wh-replay-${event.id}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    );

    this.logger.log(`Webhook event ${webhookEventId} enqueued for replay`);

    return { replayed: true, webhookEventId };
  }
}
