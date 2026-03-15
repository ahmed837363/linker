import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

import { OnboardingService } from '../modules/onboarding/onboarding.service';
import { AiAssistantService } from '../modules/ai-assistant/ai-assistant.service';

// ── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
  };
}

interface SwipePayload {
  sessionId: string;
  matchCandidateId: string;
  action: 'accept' | 'reject' | 'skip';
}

interface AiMessagePayload {
  conversationId: string;
  message: string;
  screenContext?: {
    screen?: string;
    entityIds?: Record<string, string>;
    meta?: Record<string, unknown>;
  };
}

interface SubscribeInventoryPayload {
  connectionId?: string;
}

// ── Gateway ──────────────────────────────────────────────────────────────────

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly onboardingService: OnboardingService,
    private readonly aiAssistantService: AiAssistantService,
  ) {}

  // ── Connection lifecycle ─────────────────────────────────────────────────

  /**
   * Authenticate the socket connection using the JWT token from
   * the handshake auth or query params, then join the tenant room.
   */
  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '') ??
        (client.handshake.query?.token as string);

      if (!token) {
        throw new WsException('Missing authentication token');
      }

      const payload = this.jwtService.verify<{
        sub: string;
        tenantId: string;
        email: string;
        role: string;
      }>(token, {
        secret: this.configService.getOrThrow<string>('jwt.secret'),
      });

      // Attach user data to the socket
      client.data = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        email: payload.email,
        role: payload.role,
      };

      // Join the tenant-specific room for broadcasting
      const tenantRoom = `tenant:${payload.tenantId}`;
      await client.join(tenantRoom);

      this.logger.log(
        `Client connected: ${client.id} (user ${payload.email}, tenant ${payload.tenantId})`,
      );
    } catch (error) {
      this.logger.warn(
        `Client ${client.id} failed authentication: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ── Client events ────────────────────────────────────────────────────────

  /**
   * Handle a swipe event from the client, forwarding it to the
   * OnboardingService and emitting the result back.
   */
  @SubscribeMessage('swipe')
  async handleSwipe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SwipePayload,
  ): Promise<void> {
    try {
      const { tenantId } = client.data;

      const result = await this.onboardingService.handleSwipe(
        tenantId,
        payload.sessionId,
        payload.matchCandidateId,
        payload.action,
      );

      // Emit the swipe result back to the client
      client.emit('swipe:result', {
        matchCandidateId: payload.matchCandidateId,
        ...result,
      });

      // Push next match card to the client
      const nextMatch = await this.onboardingService.getNextMatch(
        tenantId,
        payload.sessionId,
      );

      client.emit('match:next', nextMatch);

      // Broadcast progress to all tenant clients
      const session = await this.onboardingService.getSession(
        tenantId,
        payload.sessionId,
      );

      this.server
        .to(`tenant:${tenantId}`)
        .emit('match:progress', {
          sessionId: payload.sessionId,
          matchedCount: session.matchedCount,
          skippedCount: session.skippedCount,
          unmatchedCount: session.unmatchedCount,
          totalProducts: session.totalProducts,
          pendingCandidates: session.pendingCandidates,
        });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Swipe failed';
      client.emit('swipe:error', { error: message });
    }
  }

  /**
   * Handle an AI message from the client, streaming tokens back
   * via WebSocket events.
   */
  @SubscribeMessage('ai:message')
  async handleAiMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: AiMessagePayload,
  ): Promise<void> {
    try {
      const { conversationId, message, screenContext } = payload;

      const { messageId, stream } =
        await this.aiAssistantService.sendMessage(
          conversationId,
          message,
          screenContext,
        );

      let fullContent = '';
      let totalTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          client.emit('ai:token', {
            conversationId,
            messageId,
            token: delta,
          });
        }

        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens;
        }
      }

      // Persist the final assistant message
      await this.aiAssistantService.finalizeMessage(
        messageId,
        fullContent,
        totalTokens || undefined,
      );

      // Signal completion
      client.emit('ai:done', {
        conversationId,
        messageId,
        fullContent,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI message failed';
      client.emit('ai:error', {
        conversationId: payload.conversationId,
        error: message,
      });
    }
  }

  /**
   * Subscribe the client to real-time inventory update events.
   * Optionally scoped to a specific connection.
   */
  @SubscribeMessage('subscribe:inventory')
  async handleSubscribeInventory(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SubscribeInventoryPayload,
  ): Promise<void> {
    const { tenantId } = client.data;

    const room = payload.connectionId
      ? `inventory:${tenantId}:${payload.connectionId}`
      : `inventory:${tenantId}`;

    await client.join(room);

    client.emit('subscribe:inventory:ack', {
      room,
      message: 'Subscribed to inventory updates',
    });

    this.logger.debug(
      `Client ${client.id} subscribed to inventory room: ${room}`,
    );
  }

  // ── Server-emitted events (called by other services) ─────────────────────

  /**
   * Notify all tenant clients that matching is ready for a session.
   */
  emitMatchReady(tenantId: string, sessionId: string): void {
    this.server.to(`tenant:${tenantId}`).emit('match:ready', {
      sessionId,
      message: 'Product matching is complete. You can start swiping.',
    });
  }

  /**
   * Push a match card to a specific tenant room.
   */
  emitMatchNext(tenantId: string, matchData: Record<string, unknown>): void {
    this.server.to(`tenant:${tenantId}`).emit('match:next', matchData);
  }

  /**
   * Broadcast match progress update.
   */
  emitMatchProgress(
    tenantId: string,
    progress: Record<string, unknown>,
  ): void {
    this.server.to(`tenant:${tenantId}`).emit('match:progress', progress);
  }

  /**
   * Broadcast a real-time stock change notification.
   */
  emitInventoryUpdated(
    tenantId: string,
    data: {
      variantId: string;
      sku: string;
      oldQuantity: number;
      newQuantity: number;
      connectionId?: string;
    },
  ): void {
    // Emit to the general tenant inventory room
    this.server
      .to(`inventory:${tenantId}`)
      .emit('inventory:updated', data);

    // Also emit to connection-specific room if applicable
    if (data.connectionId) {
      this.server
        .to(`inventory:${tenantId}:${data.connectionId}`)
        .emit('inventory:updated', data);
    }
  }

  /**
   * Broadcast sync job progress update.
   */
  emitSyncProgress(
    tenantId: string,
    data: {
      syncJobId: string;
      jobType: string;
      status: string;
      progress: { total: number; completed: number };
    },
  ): void {
    this.server.to(`tenant:${tenantId}`).emit('sync:progress', data);
  }
}
