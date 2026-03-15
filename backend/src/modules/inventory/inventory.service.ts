import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';
import { PlatformCredentials } from '../platforms/platform.interface';
import { Prisma } from '@prisma/client';

export interface StockFilter {
  search?: string;
  lowStockOnly?: boolean;
  productId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {}

  /**
   * Get current stock for a single variant.
   */
  async getStock(tenantId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: {
        product: { select: { id: true, title: true, status: true } },
      },
    });

    if (!variant) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }

    return {
      variantId: variant.id,
      sku: variant.sku,
      productId: variant.productId,
      productTitle: variant.product.title,
      stockQuantity: variant.stockQuantity,
      lowStockThreshold: variant.lowStockThreshold,
      isLowStock: variant.stockQuantity <= variant.lowStockThreshold,
    };
  }

  /**
   * List all variants with stock levels. Supports pagination and low-stock filter.
   */
  async getAllStock(tenantId: string, filters: StockFilter = {}) {
    const { search, lowStockOnly, productId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductVariantWhereInput = {
      tenantId,
      product: { status: { not: 'archived' } },
    };

    if (productId) {
      where.productId = productId;
    }

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { product: { title: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // For low stock filtering we use a raw approach since Prisma does not
    // support column-to-column comparison in the where clause directly.
    // We fetch all matching variants and then filter in application layer
    // for the lowStockOnly flag.  For very large datasets consider a raw
    // query instead.

    const [allVariants, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        include: {
          product: { select: { id: true, title: true } },
        },
        orderBy: { stockQuantity: 'asc' },
        skip: lowStockOnly ? undefined : skip,
        take: lowStockOnly ? undefined : limit,
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    let data = allVariants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      variantTitle: v.title,
      productId: v.productId,
      productTitle: v.product.title,
      stockQuantity: v.stockQuantity,
      lowStockThreshold: v.lowStockThreshold,
      isLowStock: v.stockQuantity <= v.lowStockThreshold,
    }));

    let filteredTotal = total;

    if (lowStockOnly) {
      data = data.filter((v) => v.isLowStock);
      filteredTotal = data.length;
      data = data.slice(skip, skip + limit);
    }

    return {
      data,
      meta: {
        total: filteredTotal,
        page,
        limit,
        totalPages: Math.ceil(filteredTotal / limit),
      },
    };
  }

  /**
   * Set absolute stock quantity for a variant.
   */
  async updateStock(tenantId: string, variantId: string, quantity: number, reason?: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
    });

    if (!variant) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }

    const previousQuantity = variant.stockQuantity;

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { stockQuantity: quantity },
    });

    this.logger.log(
      `Stock updated for variant ${variantId}: ${previousQuantity} -> ${quantity}` +
        (reason ? ` (reason: ${reason})` : ''),
    );

    return {
      variantId: updated.id,
      sku: updated.sku,
      previousQuantity,
      newQuantity: updated.stockQuantity,
      reason,
    };
  }

  /**
   * Increment or decrement stock by a delta.
   */
  async adjustStock(tenantId: string, variantId: string, delta: number, reason?: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
    });

    if (!variant) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }

    const newQuantity = variant.stockQuantity + delta;

    if (newQuantity < 0) {
      throw new BadRequestException(
        `Insufficient stock: current ${variant.stockQuantity}, requested adjustment ${delta} would result in ${newQuantity}`,
      );
    }

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { stockQuantity: newQuantity },
    });

    this.logger.log(
      `Stock adjusted for variant ${variantId}: ${variant.stockQuantity} + (${delta}) = ${newQuantity}` +
        (reason ? ` (reason: ${reason})` : ''),
    );

    return {
      variantId: updated.id,
      sku: updated.sku,
      previousQuantity: variant.stockQuantity,
      delta,
      newQuantity: updated.stockQuantity,
      reason,
    };
  }

  /**
   * Fan-out push stock update to all platforms that have this variant listed.
   *
   * In production this should be debounced via BullMQ to avoid hammering
   * platform APIs when multiple stock changes happen in quick succession.
   * The queue job would call this method's core logic.
   */
  async syncStockToPlatforms(tenantId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: {
        platformListings: {
          where: { listingStatus: 'active' },
          include: {
            connection: true,
          },
        },
      },
    });

    if (!variant) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }

    if (variant.platformListings.length === 0) {
      this.logger.log(`No active listings for variant ${variantId} -- nothing to sync`);
      return { variantId, synced: 0, results: [] };
    }

    const results: {
      connectionId: string;
      platform: string;
      success: boolean;
      error?: string;
    }[] = [];

    for (const listing of variant.platformListings) {
      const { connection } = listing;

      if (connection.status !== 'active') {
        continue;
      }

      try {
        const adapter = this.platformRegistry.resolve(connection.platform);
        const credentials = connection.credentials as unknown as PlatformCredentials;

        await adapter.pushStock(credentials, variant.sku, variant.stockQuantity);

        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: true,
        });

        this.logger.log(
          `Stock synced for variant ${variantId} (SKU: ${variant.sku}) to ${connection.platform}`,
        );
      } catch (error) {
        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: false,
          error: error.message,
        });

        this.logger.error(
          `Failed to sync stock for variant ${variantId} to ${connection.platform}: ${error.message}`,
          error.stack,
        );
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      variantId,
      sku: variant.sku,
      stockQuantity: variant.stockQuantity,
      synced: succeeded,
      failed,
      results,
    };
  }

  /**
   * Get all variants below their low-stock threshold.
   */
  async getLowStockAlerts(tenantId: string) {
    // Prisma doesn't support column-to-column comparison natively,
    // so we use $queryRawUnsafe for this specific query.
    const alerts = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        sku: string;
        title: string | null;
        product_id: string;
        product_title: string;
        stock_quantity: number;
        low_stock_threshold: number;
      }[]
    >(
      `SELECT
         pv.id,
         pv.sku,
         pv.title,
         pv.product_id,
         p.title AS product_title,
         pv.stock_quantity,
         pv.low_stock_threshold
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.tenant_id = $1::uuid
         AND pv.stock_quantity <= pv.low_stock_threshold
         AND p.status != 'archived'
       ORDER BY pv.stock_quantity ASC`,
      tenantId,
    );

    return alerts.map((a) => ({
      variantId: a.id,
      sku: a.sku,
      variantTitle: a.title,
      productId: a.product_id,
      productTitle: a.product_title,
      stockQuantity: a.stock_quantity,
      lowStockThreshold: a.low_stock_threshold,
      deficit: a.low_stock_threshold - a.stock_quantity,
    }));
  }
}
