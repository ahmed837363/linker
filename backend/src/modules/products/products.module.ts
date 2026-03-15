import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, PrismaService, PlatformRegistry],
  exports: [ProductsService],
})
export class ProductsModule {}
