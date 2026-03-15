import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

import { PrismaService } from '../prisma.service';

// ── Types ────────────────────────────────────────────────────────────────────

export type ContextType = 'onboarding' | 'dashboard' | 'pricing' | 'inventory';

export interface ScreenContext {
  /** The page / route the user is currently viewing. */
  screen?: string;
  /** Any entity IDs relevant to the current view. */
  entityIds?: Record<string, string>;
  /** Arbitrary key-value metadata from the frontend. */
  meta?: Record<string, unknown>;
}

export interface StreamingResponse {
  conversationId: string;
  messageId: string;
  stream: Stream<ChatCompletionChunk>;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('openai.apiKey'),
    });
  }

  // ── Conversation CRUD ────────────────────────────────────────────────────

  /**
   * Create a new AI conversation scoped to a tenant + user.
   */
  async createConversation(
    tenantId: string,
    userId: string,
    contextType: ContextType,
    contextRef?: string,
  ) {
    const conversation = await this.prisma.aiConversation.create({
      data: {
        tenantId,
        userId,
        contextType,
        contextRef: contextRef ?? null,
      },
    });

    this.logger.log(
      `Conversation ${conversation.id} created (tenant ${tenantId}, context ${contextType})`,
    );

    return conversation;
  }

  /**
   * Load a conversation with all its messages.
   */
  async getConversation(conversationId: string) {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found`,
      );
    }

    return conversation;
  }

  // ── Send message with streaming ──────────────────────────────────────────

  /**
   * Process a user message:
   * 1. Load conversation history
   * 2. Build system prompt with rich context
   * 3. Call OpenAI GPT-4o with streaming
   * 4. Store user message immediately, store assistant message after stream completes
   * 5. Return streaming response
   */
  async sendMessage(
    conversationId: string,
    userMessage: string,
    screenContext: ScreenContext = {},
  ): Promise<StreamingResponse> {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found`,
      );
    }

    // Persist the user message
    const userMsg = await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'user',
        content: userMessage,
        contextSnapshot: screenContext as any,
      },
    });

    // Build the full message array for OpenAI
    const systemPrompt = await this.buildContextPrompt(
      conversation.contextType as ContextType,
      conversation.contextRef,
      screenContext,
      conversation.tenantId,
    );

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Append existing conversation history (last 20 messages to stay within token limits)
    const recentMessages = conversation.messages.slice(-20);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Append the new user message
    messages.push({ role: 'user', content: userMessage });

    // Create placeholder assistant message (will be updated once stream completes)
    const assistantMsg = await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: '', // Will be filled after streaming completes
      },
    });

    // Start streaming
    const stream = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      stream: true,
      max_tokens: 2048,
      temperature: 0.7,
    });

    // We return the stream to the caller. The caller is responsible for:
    // 1. Iterating the stream and forwarding tokens to the client
    // 2. Calling finalizeMessage() when the stream ends
    return {
      conversationId,
      messageId: assistantMsg.id,
      stream,
    };
  }

  /**
   * Called after the stream completes to persist the full assistant message
   * and token usage.
   */
  async finalizeMessage(
    messageId: string,
    fullContent: string,
    tokensUsed?: number,
  ): Promise<void> {
    await this.prisma.aiMessage.update({
      where: { id: messageId },
      data: {
        content: fullContent,
        tokensUsed: tokensUsed ?? null,
      },
    });
  }

  // ── Context building ─────────────────────────────────────────────────────

  /**
   * Build a rich system prompt based on the conversation context.
   */
  async buildContextPrompt(
    contextType: ContextType,
    contextRef: string | null | undefined,
    screenContext: ScreenContext,
    tenantId: string,
  ): Promise<string> {
    const parts: string[] = [
      'You are the Linker Pro AI Assistant, an expert e-commerce operations advisor.',
      'You help merchants manage their multi-platform selling operations.',
      'Be concise, actionable, and specific to the merchant\'s situation.',
      '',
    ];

    // Load tenant info
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        platformConnections: {
          where: { status: 'active' },
          select: { platform: true, shopName: true },
        },
      },
    });

    if (tenant) {
      parts.push(`Merchant: ${tenant.name}`);
      parts.push(
        `Connected stores: ${tenant.platformConnections.map((c) => `${c.shopName ?? c.platform} (${c.platform})`).join(', ')}`,
      );
      parts.push('');
    }

    // Context-specific enrichment
    switch (contextType) {
      case 'onboarding':
        await this.enrichOnboardingContext(parts, contextRef, tenantId);
        break;
      case 'dashboard':
        await this.enrichDashboardContext(parts, tenantId);
        break;
      case 'pricing':
        await this.enrichPricingContext(parts, tenantId);
        break;
      case 'inventory':
        await this.enrichInventoryContext(parts, tenantId);
        break;
    }

    // Screen-specific context from the frontend
    if (screenContext.screen) {
      parts.push(`The user is currently on the "${screenContext.screen}" screen.`);
    }

    if (screenContext.meta && Object.keys(screenContext.meta).length > 0) {
      parts.push(
        `Additional context: ${JSON.stringify(screenContext.meta)}`,
      );
    }

    return parts.join('\n');
  }

  // ── Context enrichment helpers ───────────────────────────────────────────

  private async enrichOnboardingContext(
    parts: string[],
    contextRef: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    parts.push('Context: The merchant is going through the product matching onboarding process.');
    parts.push('They are matching products across their connected e-commerce stores.');

    if (contextRef) {
      const session = await this.prisma.onboardingSession.findUnique({
        where: { id: contextRef },
        include: {
          anchorConnection: {
            select: { platform: true, shopName: true },
          },
        },
      });

      if (session) {
        parts.push(`Session status: ${session.status}`);
        parts.push(
          `Progress: ${session.matchedCount} matched, ${session.skippedCount} skipped, ` +
            `${session.unmatchedCount} unmatched out of ${session.totalProducts} total`,
        );
        if (session.anchorConnection) {
          parts.push(
            `Anchor store: ${session.anchorConnection.shopName ?? session.anchorConnection.platform}`,
          );
        }
      }
    }

    parts.push('');
    parts.push(
      'You can help with: explaining match scores, advising whether two products are the same, ' +
        'explaining what happens when they accept/reject/skip, and general onboarding guidance.',
    );
    parts.push('');
  }

  private async enrichDashboardContext(
    parts: string[],
    tenantId: string,
  ): Promise<void> {
    parts.push('Context: The merchant is viewing their dashboard.');

    // Recent orders
    const recentOrders = await this.prisma.order.findMany({
      where: { tenantId },
      orderBy: { placedAt: 'desc' },
      take: 5,
      select: {
        platformOrderId: true,
        platform: true,
        grandTotal: true,
        currency: true,
        status: true,
        placedAt: true,
      },
    });

    if (recentOrders.length > 0) {
      parts.push(`Recent orders (last ${recentOrders.length}):`);
      for (const order of recentOrders) {
        parts.push(
          `  - ${order.platform} #${order.platformOrderId}: ${order.currency} ${order.grandTotal} (${order.status})`,
        );
      }
    }

    // Low stock alerts
    const lowStockVariants = await this.prisma.productVariant.findMany({
      where: {
        tenantId,
        stockQuantity: { lte: this.prisma.productVariant.fields.lowStockThreshold as any },
      },
      take: 10,
      select: { sku: true, title: true, stockQuantity: true, lowStockThreshold: true },
    });

    if (lowStockVariants.length > 0) {
      parts.push(`Low-stock alerts (${lowStockVariants.length} items):`);
      for (const v of lowStockVariants) {
        parts.push(
          `  - ${v.sku} "${v.title ?? 'N/A'}": ${v.stockQuantity} remaining (threshold: ${v.lowStockThreshold})`,
        );
      }
    }

    parts.push('');
    parts.push(
      'You can help with: order analysis, sales trends, inventory recommendations, and store performance insights.',
    );
    parts.push('');
  }

  private async enrichPricingContext(
    parts: string[],
    tenantId: string,
  ): Promise<void> {
    parts.push('Context: The merchant is managing pricing rules.');

    const rules = await this.prisma.pricingRule.findMany({
      where: { tenantId, active: true },
      orderBy: { priority: 'desc' },
      take: 10,
    });

    if (rules.length > 0) {
      parts.push(`Active pricing rules (${rules.length}):`);
      for (const rule of rules) {
        parts.push(
          `  - "${rule.name}" (type: ${rule.ruleType}, platform: ${rule.platform ?? 'all'}, priority: ${rule.priority})`,
        );
      }
    }

    // Count affected products
    const totalProducts = await this.prisma.product.count({
      where: { tenantId, status: 'active' },
    });

    parts.push(`Total active products: ${totalProducts}`);
    parts.push('');
    parts.push(
      'You can help with: pricing strategy advice, rule configuration, ' +
        'margin analysis, and competitive pricing suggestions.',
    );
    parts.push('');
  }

  private async enrichInventoryContext(
    parts: string[],
    tenantId: string,
  ): Promise<void> {
    parts.push('Context: The merchant is managing inventory.');

    // Stock level summary
    const totalVariants = await this.prisma.productVariant.count({
      where: { tenantId },
    });

    const outOfStock = await this.prisma.productVariant.count({
      where: { tenantId, stockQuantity: 0 },
    });

    const lowStock = await this.prisma.productVariant.count({
      where: { tenantId, stockQuantity: { gt: 0, lte: 5 } },
    });

    parts.push(`Inventory overview: ${totalVariants} variants total`);
    parts.push(`  - Out of stock: ${outOfStock}`);
    parts.push(`  - Low stock (1-5 units): ${lowStock}`);
    parts.push(`  - In stock: ${totalVariants - outOfStock - lowStock}`);

    // Recent sync status
    const recentSyncs = await this.prisma.syncJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { jobType: true, status: true, createdAt: true },
    });

    if (recentSyncs.length > 0) {
      parts.push('Recent sync jobs:');
      for (const sync of recentSyncs) {
        parts.push(
          `  - ${sync.jobType}: ${sync.status} (${sync.createdAt.toISOString()})`,
        );
      }
    }

    parts.push('');
    parts.push(
      'You can help with: stock level analysis, reorder recommendations, ' +
        'sync troubleshooting, and inventory allocation across stores.',
    );
    parts.push('');
  }
}
