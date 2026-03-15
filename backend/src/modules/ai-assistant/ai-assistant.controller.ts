import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AiAssistantService,
  ContextType,
  ScreenContext,
} from './ai-assistant.service';

class CreateConversationDto {
  contextType!: ContextType;
  contextRef?: string;
}

class SendMessageDto {
  message!: string;
  screenContext?: ScreenContext;
}

@ApiTags('AI Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('ai/conversations')
export class AiAssistantController {
  constructor(private readonly aiAssistant: AiAssistantService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new AI conversation' })
  async createConversation(
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateConversationDto,
  ) {
    const conversation = await this.aiAssistant.createConversation(
      tenantId,
      userId,
      dto.contextType,
      dto.contextRef,
    );
    return { conversation };
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a message and receive a streaming AI response',
  })
  async sendMessage(
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const { messageId, stream } = await this.aiAssistant.sendMessage(
      conversationId,
      dto.message,
      dto.screenContext,
    );

    // Set up Server-Sent Events headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Message-Id', messageId);

    let fullContent = '';
    let totalTokens = 0;

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
        }

        // Track token usage from the final chunk
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens;
        }
      }

      // Send completion event
      res.write(
        `data: ${JSON.stringify({ done: true, messageId })}\n\n`,
      );

      // Persist the completed assistant message
      await this.aiAssistant.finalizeMessage(
        messageId,
        fullContent,
        totalTokens || undefined,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      res.write(
        `data: ${JSON.stringify({ error: errorMessage })}\n\n`,
      );

      // Save partial content if any was generated
      if (fullContent) {
        await this.aiAssistant.finalizeMessage(messageId, fullContent);
      }
    } finally {
      res.end();
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation history' })
  async getConversation(@Param('id') conversationId: string) {
    return this.aiAssistant.getConversation(conversationId);
  }
}
