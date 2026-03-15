import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { OrdersService } from './orders.service';
import { OrderQueryDto } from './dto/order-query.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: OrderQueryDto) {
    return this.ordersService.findAll(tenantId, query);
  }

  @Get('stats')
  getOrderStats(
    @CurrentTenant() tenantId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ordersService.getOrderStats(tenantId, { startDate, endDate });
  }

  @Get('recent')
  getRecentOrders(
    @CurrentTenant() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.getRecentOrders(tenantId, limit ? parseInt(limit, 10) : 10);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(tenantId, id);
  }
}
