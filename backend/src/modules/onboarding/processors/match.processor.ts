import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma.service';
import { MatchEngineService } from '../smart-match/match-engine.service';

/** Injected by the events gateway module to emit WS events from workers. */
export const MATCH_EVENT_EMITTER = Symbol('MATCH_EVENT_EMITTER');

export interface MatchJobData {
  sessionId: string;
}

/**
 * Abstraction so the processor can emit socket events without depending
 * directly on the gateway (which would create a circular dependency).
 */
export interface MatchEventEmitter {
  emitMatchReady(tenantId: string, sessionId: string): void;
}

@Processor('onboarding:match')
export class MatchProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchEngine: MatchEngineService,
  ) {
    super();
  }

  async process(job: Job<MatchJobData>): Promise<void> {
    const { sessionId } = job.data;

    this.logger.log(`Starting candidate matching for session ${sessionId}`);

    try {
      // Transition status: embedding -> matching
      await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { status: 'matching' },
      });

      await job.updateProgress(10);

      // Generate all candidates (barcode, text, image, price, attrs + vision)
      await this.matchEngine.generateAllCandidates(sessionId);

      await job.updateProgress(90);

      // Transition status: matching -> ready
      const session = await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { status: 'ready' },
      });

      await job.updateProgress(100);

      this.logger.log(
        `Match pipeline complete for session ${sessionId}. ` +
          `Session is now ready for swiping.`,
      );

      // We store a return value the gateway can poll / listen for
      return job.returnvalue = {
        sessionId,
        tenantId: session.tenantId,
        status: 'ready',
      } as any;
    } catch (error) {
      this.logger.error(
        `Match pipeline failed for session ${sessionId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      throw error;
    }
  }
}
