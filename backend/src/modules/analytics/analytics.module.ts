import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PrismaService } from '../prisma.service';

/**
 * Read-only analytics module.
 *
 * All heavy aggregation queries use raw SQL via `prisma.$queryRawUnsafe()`
 * with parameterized placeholders to avoid SQL injection while keeping
 * queries efficient on large datasets.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, PrismaService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
