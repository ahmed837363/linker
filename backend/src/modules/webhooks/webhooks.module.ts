import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessor } from './webhook.processor';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';

/**
 * Handles inbound platform webhooks.
 *
 * The controller receives the raw HTTP request, verifies the signature,
 * persists the event, and enqueues it for asynchronous processing.
 * The processor deduplicates, parses, and dispatches to the appropriate
 * domain service.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook-processing' }),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookProcessor,
    PrismaService,
    PlatformRegistry,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
