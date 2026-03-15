import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma.service';
import { AiAssistantService } from './ai-assistant.service';
import { AiAssistantController } from './ai-assistant.controller';

@Module({
  controllers: [AiAssistantController],
  providers: [PrismaService, AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
