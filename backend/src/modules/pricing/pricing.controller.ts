import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { PricingService } from './pricing.service';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';

@Controller('pricing')
@UseGuards(JwtAuthGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  findAllRules(@CurrentTenant() tenantId: string) {
    return this.pricingService.findAllRules(tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createRule(@CurrentTenant() tenantId: string, @Body() dto: CreatePricingRuleDto) {
    return this.pricingService.createRule(tenantId, dto);
  }

  @Get('preview')
  previewPricing(
    @CurrentTenant() tenantId: string,
    @Query('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.pricingService.previewPricing(tenantId, productId);
  }

  @Patch(':id')
  updateRule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingRuleDto,
  ) {
    return this.pricingService.updateRule(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deleteRule(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.pricingService.deleteRule(tenantId, id);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  applyBulkPricing(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pricingService.applyBulkPricing(tenantId, id);
  }
}
