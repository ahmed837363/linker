import {
  Controller,
  Post,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';
import { PlatformType } from '../platforms/platform.interface';
import { WebhooksService } from './webhooks.service';

/**
 * Universal webhook receiver.
 *
 * Every platform's webhook configuration points at
 * `POST /webhooks/:platform/:connectionId`. The controller validates the
 * inbound request, stores it, and enqueues it for processing -- returning
 * 200 as fast as possible so the calling platform does not time out.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
    private readonly webhooksService: WebhooksService,
    @InjectQueue('webhook-processing') private readonly webhookQueue: Queue,
  ) {}

  @Post(':platform/:connectionId')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Param('platform') platform: string,
    @Param('connectionId') connectionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ received: boolean }> {
    // ── 1. Validate platform key ──────────────────────────────────────────
    if (!Object.values(PlatformType).includes(platform as PlatformType)) {
      throw new BadRequestException(`Unknown platform: ${platform}`);
    }
    const platformKey = platform as PlatformType;

    // ── 2. Look up the PlatformConnection ─────────────────────────────────
    const connection = await this.prisma.platformConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException(`Connection ${connectionId} not found`);
    }

    if (connection.platform !== platformKey) {
      throw new BadRequestException(
        `Connection ${connectionId} belongs to ${connection.platform}, not ${platformKey}`,
      );
    }

    // ── 3. Get the adapter from PlatformRegistry ──────────────────────────
    const adapter = this.platformRegistry.resolve(platformKey);

    // ── 4. Verify the webhook signature ───────────────────────────────────
    const headers = this.normalizeHeaders(req.headers as Record<string, string>);
    const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);

    // The webhook secret is stored in the connection credentials or as a
    // dedicated field. We look for a `webhookSecret` key in credentials.
    const credentials = connection.credentials as Record<string, unknown>;
    const webhookSecret = (credentials.webhookSecret as string) ?? '';

    const isValid = adapter.verifyWebhookSignature(headers, rawBody, webhookSecret);
    if (!isValid) {
      this.logger.warn(
        `Invalid webhook signature for connection ${connectionId} on ${platformKey}`,
      );
      throw new BadRequestException('Invalid webhook signature');
    }

    // ── 5. Generate idempotency key ───────────────────────────────────────
    const idempotencyKey = this.generateIdempotencyKey(platformKey, headers, rawBody);

    // ── 6. Store raw event in WebhookEvent table ──────────────────────────
    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      parsedPayload = { raw: typeof rawBody === 'string' ? rawBody : rawBody.toString() };
    }

    // Attempt a quick parse to get the event type for storage
    let eventType = 'unknown';
    try {
      const parsed = adapter.parseWebhookEvent(headers, rawBody);
      eventType = parsed.topic;
    } catch {
      // We will parse again in the processor; store as 'unknown' for now
    }

    const webhookEvent = await this.webhooksService.storeEvent({
      connectionId: connection.id,
      platform: platformKey,
      eventType,
      idempotencyKey,
      headers,
      payload: parsedPayload,
    });

    // ── 7. Enqueue job to 'webhook-processing' queue ──────────────────────
    await this.webhookQueue.add(
      'process-webhook',
      {
        webhookEventId: webhookEvent.id,
        connectionId: connection.id,
        tenantId: connection.tenantId,
        platform: platformKey,
      },
      {
        jobId: `wh-${idempotencyKey}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 7 * 24 * 3600 }, // 7 days
        removeOnFail: { age: 30 * 24 * 3600 },    // 30 days
      },
    );

    this.logger.log(
      `Webhook received and enqueued: ${platformKey}/${connectionId} [${eventType}] key=${idempotencyKey}`,
    );

    // ── 8. Return 200 immediately ─────────────────────────────────────────
    return { received: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Build a deterministic idempotency key from the platform event ID
   * (if present in common header locations) or a SHA-256 of the payload.
   */
  private generateIdempotencyKey(
    platform: string,
    headers: Record<string, string>,
    body: string | Buffer,
  ): string {
    // Many platforms include an event / delivery ID in headers
    const candidateHeaders = [
      'x-shopify-webhook-id',
      'x-delivery-id',
      'x-event-id',
      'x-wc-webhook-delivery-id',
      'x-amzn-requestid',
      'x-salla-event-id',
    ];

    for (const header of candidateHeaders) {
      const value = headers[header];
      if (value) {
        return `${platform}:${value}`;
      }
    }

    // Fallback: hash the payload
    const hash = createHash('sha256')
      .update(typeof body === 'string' ? body : body)
      .digest('hex')
      .slice(0, 40);

    return `${platform}:sha256:${hash}`;
  }

  /** Lowercase all header keys for uniform access. */
  private normalizeHeaders(headers: Record<string, any>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        normalized[key.toLowerCase()] = value;
      }
    }
    return normalized;
  }
}
