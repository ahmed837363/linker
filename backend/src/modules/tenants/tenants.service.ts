import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    return tenant;
  }

  async findBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with slug "${slug}" not found`);
    }

    return tenant;
  }

  async update(
    tenantId: string,
    data: { name?: string; plan?: string },
  ) {
    // Verify the tenant exists before updating
    await this.findById(tenantId);

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    });

    this.logger.log(`Tenant updated: ${updated.id} (${updated.name})`);

    return updated;
  }

  async getConnections(tenantId: string) {
    // Verify the tenant exists
    await this.findById(tenantId);

    const connections = await this.prisma.platformConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        platformShopId: true,
        shopName: true,
        status: true,
        scopes: true,
        tokenExpiresAt: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return connections;
  }
}
