import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** ISO date-range input for analytics methods. */
export interface DateRange {
  startDate: string; // ISO-8601
  endDate: string;   // ISO-8601
}

export type Granularity = 'day' | 'week' | 'month';

// ── Response shapes ─────────────────────────────────────────────────────────

export interface SalesOverview {
  totalRevenue: number;
  ordersCount: number;
  averageOrderValue: number;
}

export interface PlatformSalesBreakdown {
  platform: string;
  totalRevenue: number;
  ordersCount: number;
  averageOrderValue: number;
}

export interface TopProduct {
  productId: string;
  title: string;
  totalRevenue: number;
  totalQuantity: number;
}

export interface RevenueTimeSeriesPoint {
  bucket: string; // ISO date string for the bucket start
  revenue: number;
  orders: number;
}

export interface InventoryOverview {
  totalSkus: number;
  totalStockValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface PlatformHealthEntry {
  connectionId: string;
  platform: string;
  shopName: string | null;
  status: string;
  lastSyncedAt: string | null;
  errorCountLast24h: number;
}

/**
 * Analytics service backed entirely by parameterized raw SQL for
 * efficient aggregation across large order / inventory datasets.
 *
 * Every query is tenant-scoped: the `tenantId` is always the first
 * bound parameter (`$1`).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────
  // Sales Overview (all platforms combined)
  // ────────────────────────────────────────────────────────────────────────

  async getSalesOverview(
    tenantId: string,
    dateRange: DateRange,
  ): Promise<SalesOverview> {
    this.validateDateRange(dateRange);

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(SUM(grand_total), 0)::float   AS "totalRevenue",
        COUNT(*)::int                           AS "ordersCount",
        CASE
          WHEN COUNT(*) > 0
          THEN (SUM(grand_total) / COUNT(*))::float
          ELSE 0
        END                                     AS "averageOrderValue"
      FROM orders
      WHERE tenant_id = $1::uuid
        AND placed_at >= $2::timestamptz
        AND placed_at <  $3::timestamptz
      `,
      tenantId,
      new Date(dateRange.startDate),
      new Date(dateRange.endDate),
    );

    const row = rows[0] ?? {
      totalRevenue: 0,
      ordersCount: 0,
      averageOrderValue: 0,
    };

    return {
      totalRevenue: Number(row.totalRevenue),
      ordersCount: Number(row.ordersCount),
      averageOrderValue: Number(row.averageOrderValue),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Sales by Platform
  // ────────────────────────────────────────────────────────────────────────

  async getSalesByPlatform(
    tenantId: string,
    dateRange: DateRange,
  ): Promise<PlatformSalesBreakdown[]> {
    this.validateDateRange(dateRange);

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        platform::text                          AS "platform",
        COALESCE(SUM(grand_total), 0)::float   AS "totalRevenue",
        COUNT(*)::int                           AS "ordersCount",
        CASE
          WHEN COUNT(*) > 0
          THEN (SUM(grand_total) / COUNT(*))::float
          ELSE 0
        END                                     AS "averageOrderValue"
      FROM orders
      WHERE tenant_id = $1::uuid
        AND placed_at >= $2::timestamptz
        AND placed_at <  $3::timestamptz
      GROUP BY platform
      ORDER BY "totalRevenue" DESC
      `,
      tenantId,
      new Date(dateRange.startDate),
      new Date(dateRange.endDate),
    );

    return rows.map((r) => ({
      platform: r.platform,
      totalRevenue: Number(r.totalRevenue),
      ordersCount: Number(r.ordersCount),
      averageOrderValue: Number(r.averageOrderValue),
    }));
  }

  // ────────────────────────────────────────────────────────────────────────
  // Top Products
  // ────────────────────────────────────────────────────────────────────────

  async getTopProducts(
    tenantId: string,
    dateRange: DateRange,
    limit: number = 10,
  ): Promise<TopProduct[]> {
    this.validateDateRange(dateRange);

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        p.id                                       AS "productId",
        p.title                                    AS "title",
        COALESCE(SUM(oi.total_price), 0)::float   AS "totalRevenue",
        COALESCE(SUM(oi.quantity), 0)::int         AS "totalQuantity"
      FROM order_items oi
      JOIN orders      o  ON o.id = oi.order_id
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN products    p  ON p.id = pv.product_id
      WHERE o.tenant_id = $1::uuid
        AND o.placed_at >= $2::timestamptz
        AND o.placed_at <  $3::timestamptz
      GROUP BY p.id, p.title
      ORDER BY "totalRevenue" DESC
      LIMIT $4::int
      `,
      tenantId,
      new Date(dateRange.startDate),
      new Date(dateRange.endDate),
      limit,
    );

    return rows.map((r) => ({
      productId: r.productId,
      title: r.title,
      totalRevenue: Number(r.totalRevenue),
      totalQuantity: Number(r.totalQuantity),
    }));
  }

  // ────────────────────────────────────────────────────────────────────────
  // Revenue Time Series
  // ────────────────────────────────────────────────────────────────────────

  async getRevenueTimeSeries(
    tenantId: string,
    dateRange: DateRange,
    granularity: Granularity = 'day',
  ): Promise<RevenueTimeSeriesPoint[]> {
    this.validateDateRange(dateRange);

    const truncExpr = this.pgDateTrunc(granularity);

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        ${truncExpr}                              AS "bucket",
        COALESCE(SUM(grand_total), 0)::float     AS "revenue",
        COUNT(*)::int                             AS "orders"
      FROM orders
      WHERE tenant_id = $1::uuid
        AND placed_at >= $2::timestamptz
        AND placed_at <  $3::timestamptz
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
      `,
      tenantId,
      new Date(dateRange.startDate),
      new Date(dateRange.endDate),
    );

    return rows.map((r) => ({
      bucket: r.bucket instanceof Date ? r.bucket.toISOString() : String(r.bucket),
      revenue: Number(r.revenue),
      orders: Number(r.orders),
    }));
  }

  // ────────────────────────────────────────────────────────────────────────
  // Inventory Overview
  // ────────────────────────────────────────────────────────────────────────

  async getInventoryOverview(tenantId: string): Promise<InventoryOverview> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int                                                  AS "totalSkus",
        COALESCE(SUM(stock_quantity * COALESCE(cost_price, base_price)), 0)::float
                                                                       AS "totalStockValue",
        COUNT(*) FILTER (
          WHERE stock_quantity > 0
            AND stock_quantity <= low_stock_threshold
        )::int                                                         AS "lowStockCount",
        COUNT(*) FILTER (WHERE stock_quantity = 0)::int                AS "outOfStockCount"
      FROM product_variants
      WHERE tenant_id = $1::uuid
      `,
      tenantId,
    );

    const row = rows[0] ?? {
      totalSkus: 0,
      totalStockValue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    };

    return {
      totalSkus: Number(row.totalSkus),
      totalStockValue: Number(row.totalStockValue),
      lowStockCount: Number(row.lowStockCount),
      outOfStockCount: Number(row.outOfStockCount),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Platform Health
  // ────────────────────────────────────────────────────────────────────────

  async getPlatformHealth(tenantId: string): Promise<PlatformHealthEntry[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        pc.id                        AS "connectionId",
        pc.platform::text            AS "platform",
        pc.shop_name                 AS "shopName",
        pc.status                    AS "status",
        pc.last_synced_at            AS "lastSyncedAt",
        COALESCE(err.cnt, 0)::int   AS "errorCountLast24h"
      FROM platform_connections pc
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt
        FROM webhook_events we
        WHERE we.connection_id = pc.id
          AND we.status = 'failed'
          AND we.created_at >= NOW() - INTERVAL '24 hours'
      ) err ON true
      WHERE pc.tenant_id = $1::uuid
      ORDER BY pc.platform, pc.shop_name
      `,
      tenantId,
    );

    return rows.map((r) => ({
      connectionId: r.connectionId,
      platform: r.platform,
      shopName: r.shopName,
      status: r.status,
      lastSyncedAt: r.lastSyncedAt
        ? (r.lastSyncedAt instanceof Date
            ? r.lastSyncedAt.toISOString()
            : String(r.lastSyncedAt))
        : null,
      errorCountLast24h: Number(r.errorCountLast24h),
    }));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Return a safe `date_trunc(...)` SQL fragment. Because the granularity
   * value is whitelisted there is no injection risk even though it is
   * interpolated into the query string.
   */
  private pgDateTrunc(granularity: Granularity): string {
    const allowed: Record<Granularity, string> = {
      day: 'day',
      week: 'week',
      month: 'month',
    };

    const pg = allowed[granularity];
    if (!pg) {
      throw new BadRequestException(
        `Invalid granularity "${granularity}". Allowed: day, week, month`,
      );
    }

    return `date_trunc('${pg}', placed_at)`;
  }

  private validateDateRange(dateRange: DateRange): void {
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException(
        'startDate and endDate must be valid ISO-8601 date strings',
      );
    }

    if (start >= end) {
      throw new BadRequestException('startDate must be before endDate');
    }
  }
}
