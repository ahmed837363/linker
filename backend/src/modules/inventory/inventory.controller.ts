import {
  Controller,
  Get,
  Patch,
  Post,
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
import { InventoryService, StockFilter } from './inventory.service';
import { UpdateStockDto } from './dto/update-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  getAllStock(
    @CurrentTenant() tenantId: string,
    @Query('search') search?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
    @Query('productId') productId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: StockFilter = {
      search,
      lowStockOnly: lowStockOnly === 'true',
      productId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    };
    return this.inventoryService.getAllStock(tenantId, filters);
  }

  @Get('alerts/low-stock')
  getLowStockAlerts(@CurrentTenant() tenantId: string) {
    return this.inventoryService.getLowStockAlerts(tenantId);
  }

  @Get(':variantId')
  getStock(
    @CurrentTenant() tenantId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.inventoryService.getStock(tenantId, variantId);
  }

  @Patch(':variantId')
  @HttpCode(HttpStatus.OK)
  updateStock(
    @CurrentTenant() tenantId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateStockDto,
  ) {
    return this.inventoryService.updateStock(tenantId, variantId, dto.quantity, dto.reason);
  }

  @Post(':variantId/adjust')
  @HttpCode(HttpStatus.OK)
  adjustStock(
    @CurrentTenant() tenantId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.inventoryService.adjustStock(tenantId, variantId, dto.delta, dto.reason);
  }
}
