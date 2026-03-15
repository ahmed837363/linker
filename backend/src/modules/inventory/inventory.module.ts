import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, PrismaService, PlatformRegistry],
  exports: [InventoryService],
})
export class InventoryModule {}
