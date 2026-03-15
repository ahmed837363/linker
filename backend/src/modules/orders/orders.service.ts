import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NormalizedOrder } from '../platforms/platform.interface';
import { OrderQueryDto } from './dto/order-query.dto';
import { Prisma, PlatformType } from '@prisma/client';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List orders with pagination, platform filter, date range, and status filter.
   */
  async findAll(tenantId: string, query: OrderQueryDto) {
    const { platform, status, startDate, endDate, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = { tenantId };

    if (platform) {
      where.platform = platform as PlatformType;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.placedAt = {};
      if (startDate) {
        where.placedAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.placedAt.lte = new Date(endDate);
      }
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          connection: { select: { id: true, platform: true, shopName: true } },
          _count: { select: { items: true } },
        },
        orderBy: { placedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single order with all its items.
   */
  async findOne(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        connection: { select: { id: true, platform: true, shopName: true } },
        items: {
          include: {
            variant: {
              select: { id: true, sku: true, title: true, productId: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return order;
  }

  /**
   * Look up an order by the platform's own order ID.
   */
  async getByPlatformOrderId(tenantId: string, connectionId: string, platformOrderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        tenantId,
        connectionId,
        platformOrderId,
      },
      include: {
        connection: { select: { id: true, platform: true, shopName: true } },
        items: true,
      },
    });

    if (!order) {
      throw new NotFoundException(
        `Order with platform ID "${platformOrderId}" not found on connection ${connectionId}`,
      );
    }

    return order;
  }

  /**
   * Create an order from normalized webhook data and decrement inventory.
   */
  async createFromWebhook(
    tenantId: string,
    connectionId: string,
    normalizedOrder: NormalizedOrder,
  ) {
    const connection = await this.prisma.platformConnection.findFirst({
      where: { id: connectionId, tenantId },
    });

    if (!connection) {
      throw new NotFoundException(`Connection ${connectionId} not found`);
    }

    // Check for duplicate order (idempotency)
    const existing = await this.prisma.order.findFirst({
      where: {
        connectionId,
        platformOrderId: normalizedOrder.platformOrderId,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Order with platform ID "${normalizedOrder.platformOrderId}" already exists`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Resolve variant IDs for each line item by matching SKU
      const itemsWithVariants = await Promise.all(
        normalizedOrder.items.map(async (item) => {
          let variantId: string | null = null;

          if (item.sku) {
            // Try to find the variant by SKU within the tenant
            const variant = await tx.productVariant.findFirst({
              where: { tenantId, sku: item.sku },
            });

            if (variant) {
              variantId = variant.id;

              // Decrement inventory
              const newQuantity = variant.stockQuantity - item.quantity;
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { stockQuantity: Math.max(0, newQuantity) },
              });

              if (newQuantity < 0) {
                this.logger.warn(
                  `Stock went negative for variant ${variant.id} (SKU: ${item.sku}): ` +
                    `was ${variant.stockQuantity}, ordered ${item.quantity}, clamped to 0`,
                );
              }
            }
          }

          return {
            variantId,
            platformSku: item.sku ?? null,
            title: item.title ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          };
        }),
      );

      const order = await tx.order.create({
        data: {
          tenantId,
          connectionId,
          platform: connection.platform,
          platformOrderId: normalizedOrder.platformOrderId,
          status: normalizedOrder.status,
          currency: normalizedOrder.currency,
          subtotal: normalizedOrder.subtotal,
          taxTotal: normalizedOrder.taxTotal,
          shippingTotal: normalizedOrder.shippingTotal,
          grandTotal: normalizedOrder.grandTotal,
          customer: (normalizedOrder.customer ?? null) as Prisma.InputJsonValue,
          shippingAddress: (normalizedOrder.shippingAddress ?? null) as Prisma.InputJsonValue,
          placedAt: normalizedOrder.placedAt,
          items: {
            create: itemsWithVariants,
          },
        },
        include: {
          items: true,
          connection: { select: { id: true, platform: true, shopName: true } },
        },
      });

      this.logger.log(
        `Order created from webhook: ${order.id} (platform: ${connection.platform}, ` +
          `platformOrderId: ${normalizedOrder.platformOrderId}, items: ${order.items.length})`,
      );

      return order;
    });
  }

  /**
   * Get recent orders for the dashboard widget.
   */
  async getRecentOrders(tenantId: string, limit: number = 10) {
    return this.prisma.order.findMany({
      where: { tenantId },
      include: {
        connection: { select: { id: true, platform: true, shopName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { placedAt: 'desc' },
      take: Math.min(limit, 50),
    });
  }

  /**
   * Get order statistics: totals grouped by platform within a date range.
   */
  async getOrderStats(tenantId: string, dateRange: { startDate?: string; endDate?: string }) {
    const where: Prisma.OrderWhereInput = { tenantId };

    if (dateRange.startDate || dateRange.endDate) {
      where.placedAt = {};
      if (dateRange.startDate) {
        where.placedAt.gte = new Date(dateRange.startDate);
      }
      if (dateRange.endDate) {
        where.placedAt.lte = new Date(dateRange.endDate);
      }
    }

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        platform: true,
        grandTotal: true,
        status: true,
      },
    });

    // Aggregate by platform
    const byPlatform = new Map<
      string,
      { orderCount: number; totalRevenue: number; statusBreakdown: Record<string, number> }
    >();

    for (const order of orders) {
      const key = order.platform;
      const entry = byPlatform.get(key) ?? {
        orderCount: 0,
        totalRevenue: 0,
        statusBreakdown: {},
      };

      entry.orderCount += 1;
      entry.totalRevenue += Number(order.grandTotal);
      entry.statusBreakdown[order.status] = (entry.statusBreakdown[order.status] ?? 0) + 1;

      byPlatform.set(key, entry);
    }

    const platformStats = Array.from(byPlatform.entries()).map(([platform, stats]) => ({
      platform,
      ...stats,
      totalRevenue: Math.round(stats.totalRevenue * 100) / 100,
    }));

    const totalOrders = orders.length;
    const totalRevenue =
      Math.round(orders.reduce((sum, o) => sum + Number(o.grandTotal), 0) * 100) / 100;

    return {
      totalOrders,
      totalRevenue,
      byPlatform: platformStats,
    };
  }
}
