import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AnalyticsService, Granularity } from './analytics.service';
import { AnalyticsQueryDto, TopProductsQueryDto } from './dto/analytics-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Read-only analytics endpoints. All responses are scoped to the
 * authenticated user's tenant.
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  // ── Sales ─────────────────────────────────────────────────────────────────

  @Get('overview')
  async getSalesOverview(
    @Query() query: AnalyticsQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.analyticsService.getSalesOverview(user.tenantId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get('by-platform')
  async getSalesByPlatform(
    @Query() query: AnalyticsQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.analyticsService.getSalesByPlatform(user.tenantId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get('top-products')
  async getTopProducts(
    @Query() query: TopProductsQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    return this.analyticsService.getTopProducts(
      user.tenantId,
      { startDate: query.startDate, endDate: query.endDate },
      limit,
    );
  }

  @Get('revenue-series')
  async getRevenueTimeSeries(
    @Query() query: AnalyticsQueryDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    const granularity: Granularity = query.granularity ?? 'day';
    return this.analyticsService.getRevenueTimeSeries(
      user.tenantId,
      { startDate: query.startDate, endDate: query.endDate },
      granularity,
    );
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  @Get('inventory')
  async getInventoryOverview(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.analyticsService.getInventoryOverview(user.tenantId);
  }

  // ── Platform Health ───────────────────────────────────────────────────────

  @Get('health')
  async getPlatformHealth(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.analyticsService.getPlatformHealth(user.tenantId);
  }
}
