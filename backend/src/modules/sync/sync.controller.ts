import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * REST endpoints for triggering and monitoring synchronisation jobs.
 * All endpoints require JWT authentication and scope to the caller's tenant.
 */
@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly syncService: SyncService) {}

  // ── Trigger endpoints ─────────────────────────────────────────────────────

  @Post('inventory/:variantId')
  @HttpCode(HttpStatus.ACCEPTED)
  async pushInventory(
    @Param('variantId') variantId: string,
    @Query('platform') platform: string,
    @Query('connectionId') connectionId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.syncService.queueInventoryPush(
      user.tenantId,
      variantId,
      platform,
      connectionId,
    );
  }

  @Post('products/:productId')
  @HttpCode(HttpStatus.ACCEPTED)
  async pushProduct(
    @Param('productId') productId: string,
    @Query('connectionId') connectionId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.syncService.queueProductPush(
      user.tenantId,
      productId,
      connectionId,
    );
  }

  @Post('orders/:connectionId')
  @HttpCode(HttpStatus.ACCEPTED)
  async pullOrders(
    @Param('connectionId') connectionId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.syncService.queueOrderPull(user.tenantId, connectionId);
  }

  @Post('full-import/:connectionId')
  @HttpCode(HttpStatus.ACCEPTED)
  async fullImport(
    @Param('connectionId') connectionId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.syncService.queueFullImport(user.tenantId, connectionId);
  }

  // ── Status endpoints ──────────────────────────────────────────────────────

  @Get('jobs')
  async listJobs(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('jobType') jobType?: string,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.syncService.getRecentJobs(user.tenantId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      jobType,
    });
  }

  @Get('jobs/:id')
  async getJob(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedUser;
    return this.syncService.getSyncJobStatus(user.tenantId, id);
  }
}
