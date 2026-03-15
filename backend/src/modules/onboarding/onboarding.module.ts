import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';

import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { MatchEngineService } from './smart-match/match-engine.service';
import { ImportProcessor } from './processors/import.processor';
import { EmbedProcessor } from './processors/embed.processor';
import { MatchProcessor } from './processors/match.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'onboarding:import' },
      { name: 'onboarding:embed' },
      { name: 'onboarding:match' },
    ),
  ],
  controllers: [OnboardingController],
  providers: [
    PrismaService,
    PlatformRegistry,
    OnboardingService,
    MatchEngineService,
    ImportProcessor,
    EmbedProcessor,
    MatchProcessor,
  ],
  exports: [OnboardingService, MatchEngineService],
})
export class OnboardingModule {}
