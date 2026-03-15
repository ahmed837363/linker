import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';

@Module({
  controllers: [PricingController],
  providers: [PricingService, PrismaService, PlatformRegistry],
  exports: [PricingService],
})
export class PricingModule {}
