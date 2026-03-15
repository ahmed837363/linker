import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@Controller('tenants')
@UseGuards(JwtAuthGuard, TenantGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMyTenant(@CurrentTenant() tenantId: string) {
    return this.tenantsService.findById(tenantId);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  async updateMyTenant(
    @CurrentTenant() tenantId: string,
    @Body() data: { name?: string; plan?: string },
  ) {
    return this.tenantsService.update(tenantId, data);
  }

  @Get('me/connections')
  @HttpCode(HttpStatus.OK)
  async getMyConnections(@CurrentTenant() tenantId: string) {
    return this.tenantsService.getConnections(tenantId);
  }
}
