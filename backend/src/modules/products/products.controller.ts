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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateProductDto) {
    return this.productsService.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ProductQueryDto) {
    return this.productsService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.delete(tenantId, id);
  }

  @Post(':id/push/:connectionId')
  @HttpCode(HttpStatus.OK)
  pushToPlatform(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.productsService.pushToPlatform(tenantId, id, connectionId);
  }

  @Post(':id/push-all')
  @HttpCode(HttpStatus.OK)
  pushToAllPlatforms(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.pushToAllPlatforms(tenantId, id);
  }
}
