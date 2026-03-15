import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';

import { PrismaService } from '../../prisma.service';
import { MatchEngineService } from '../smart-match/match-engine.service';

export interface EmbedJobData {
  sessionId: string;
}

@Processor('onboarding:embed')
export class EmbedProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchEngine: MatchEngineService,
    @InjectQueue('onboarding:match')
    private readonly matchQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<EmbedJobData>): Promise<void> {
    const { sessionId } = job.data;

    this.logger.log(`Starting embedding generation for session ${sessionId}`);

    try {
      // Update session status
      await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { status: 'embedding' },
      });

      // Step 1: Generate text embeddings
      await job.updateProgress(10);
      await this.matchEngine.generateEmbeddings(sessionId);
      await job.updateProgress(50);

      // Step 2: Generate image embeddings
      await this.matchEngine.generateImageEmbeddings(sessionId);
      await job.updateProgress(100);

      this.logger.log(
        `Embedding generation complete for session ${sessionId}. Enqueuing match job.`,
      );

      // Enqueue the matching phase
      await this.matchQueue.add('match', { sessionId });
    } catch (error) {
      this.logger.error(
        `Embedding generation failed for session ${sessionId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      throw error;
    }
  }
}
