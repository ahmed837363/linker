import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';
import { PlatformCredentials, ListingChanges } from '../platforms/platform.interface';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { Prisma, PlatformType, ProductVariant } from '@prisma/client';

interface VariantContext {
  basePrice: number;
  costPrice: number | null;
  sku: string;
  productCategory: string | null;
  productBrand: string | null;
  productTags: string[];
}

interface Adjustment {
  type: string;
  value: number;
  [key: string]: unknown;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {}

  /**
   * Create a new pricing rule.
   */
  async createRule(tenantId: string, dto: CreatePricingRuleDto) {
    const rule = await this.prisma.pricingRule.create({
      data: {
        tenantId,
        name: dto.name,
        ruleType: dto.ruleType,
        platform: dto.platform as PlatformType | undefined,
        conditions: (dto.conditions ?? {}) as Prisma.InputJsonValue,
        adjustment: dto.adjustment as Prisma.InputJsonValue,
        priority: dto.priority ?? 0,
        active: dto.active ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      },
    });

    this.logger.log(`Pricing rule created: ${rule.id} "${rule.name}" for tenant ${tenantId}`);
    return rule;
  }

  /**
   * List all pricing rules ordered by priority (descending).
   */
  async findAllRules(tenantId: string) {
    return this.prisma.pricingRule.findMany({
      where: { tenantId },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Update an existing pricing rule.
   */
  async updateRule(tenantId: string, id: string, dto: UpdatePricingRuleDto) {
    const existing = await this.prisma.pricingRule.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }

    const updateData: Prisma.PricingRuleUpdateInput = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.ruleType !== undefined) updateData.ruleType = dto.ruleType;
    if (dto.platform !== undefined) updateData.platform = dto.platform as PlatformType;
    if (dto.conditions !== undefined) updateData.conditions = dto.conditions as Prisma.InputJsonValue;
    if (dto.adjustment !== undefined) updateData.adjustment = dto.adjustment as Prisma.InputJsonValue;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.active !== undefined) updateData.active = dto.active;
    if (dto.startsAt !== undefined) updateData.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined) updateData.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;

    const rule = await this.prisma.pricingRule.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Pricing rule updated: ${id} for tenant ${tenantId}`);
    return rule;
  }

  /**
   * Delete a pricing rule.
   */
  async deleteRule(tenantId: string, id: string) {
    const existing = await this.prisma.pricingRule.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Pricing rule ${id} not found`);
    }

    await this.prisma.pricingRule.delete({ where: { id } });

    this.logger.log(`Pricing rule deleted: ${id} for tenant ${tenantId}`);
    return { deleted: true, id };
  }

  /**
   * Calculate the final price for a variant on a specific platform by applying
   * the full pricing rule chain in priority order.
   */
  async calculatePrice(
    tenantId: string,
    variant: VariantContext,
    platform: PlatformType,
  ): Promise<{ finalPrice: number; appliedRules: { ruleId: string; name: string; adjustment: number }[] }> {
    const now = new Date();

    const rules = await this.prisma.pricingRule.findMany({
      where: {
        tenantId,
        active: true,
        OR: [{ platform: null }, { platform }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { priority: 'desc' },
    });

    let currentPrice = variant.basePrice;
    const appliedRules: { ruleId: string; name: string; adjustment: number }[] = [];

    for (const rule of rules) {
      const conditions = rule.conditions as Record<string, unknown>;

      if (!this.matchesConditions(variant, conditions)) {
        continue;
      }

      const adjustment = rule.adjustment as unknown as Adjustment;
      const previousPrice = currentPrice;

      currentPrice = this.applyAdjustment(currentPrice, adjustment, variant);

      // Ensure price never goes below zero
      currentPrice = Math.max(0, currentPrice);

      appliedRules.push({
        ruleId: rule.id,
        name: rule.name,
        adjustment: Math.round((currentPrice - previousPrice) * 100) / 100,
      });
    }

    // Round to 2 decimal places
    const finalPrice = Math.round(currentPrice * 100) / 100;

    return { finalPrice, appliedRules };
  }

  /**
   * Preview pricing for a product across all connected platforms.
   */
  async previewPricing(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: { variants: true },
    });

    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }

    const connections = await this.prisma.platformConnection.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, platform: true, shopName: true },
    });

    const preview: {
      variantId: string;
      sku: string;
      basePrice: number;
      platforms: {
        connectionId: string;
        platform: string;
        shopName: string | null;
        finalPrice: number;
        appliedRules: { ruleId: string; name: string; adjustment: number }[];
      }[];
    }[] = [];

    for (const variant of product.variants) {
      const variantContext: VariantContext = {
        basePrice: Number(variant.basePrice),
        costPrice: variant.costPrice ? Number(variant.costPrice) : null,
        sku: variant.sku,
        productCategory: product.category,
        productBrand: product.brand,
        productTags: product.tags,
      };

      const platforms: {
        connectionId: string;
        platform: string;
        shopName: string | null;
        finalPrice: number;
        appliedRules: { ruleId: string; name: string; adjustment: number }[];
      }[] = [];

      for (const conn of connections) {
        const result = await this.calculatePrice(tenantId, variantContext, conn.platform);
        platforms.push({
          connectionId: conn.id,
          platform: conn.platform,
          shopName: conn.shopName,
          finalPrice: result.finalPrice,
          appliedRules: result.appliedRules,
        });
      }

      preview.push({
        variantId: variant.id,
        sku: variant.sku,
        basePrice: Number(variant.basePrice),
        platforms,
      });
    }

    return preview;
  }

  /**
   * Apply bulk pricing: recalculate and push prices for all listings
   * affected by a specific rule.
   *
   * In production this would queue a BullMQ job; here we execute synchronously.
   */
  async applyBulkPricing(tenantId: string, ruleId: string) {
    const rule = await this.prisma.pricingRule.findFirst({
      where: { id: ruleId, tenantId },
    });

    if (!rule) {
      throw new NotFoundException(`Pricing rule ${ruleId} not found`);
    }

    // Find all active listings for this tenant, scoped to the rule's platform
    const listingWhere: Prisma.PlatformListingWhereInput = {
      tenantId,
      listingStatus: 'active',
    };

    if (rule.platform) {
      listingWhere.platform = rule.platform;
    }

    const listings = await this.prisma.platformListing.findMany({
      where: listingWhere,
      include: {
        variant: true,
        product: { select: { category: true, brand: true, tags: true } },
        connection: true,
      },
    });

    const results: {
      listingId: string;
      variantSku: string;
      platform: string;
      oldPrice: number;
      newPrice: number;
      pushed: boolean;
      error?: string;
    }[] = [];

    for (const listing of listings) {
      const { variant, product, connection } = listing;

      const variantContext: VariantContext = {
        basePrice: Number(variant.basePrice),
        costPrice: variant.costPrice ? Number(variant.costPrice) : null,
        sku: variant.sku,
        productCategory: product.category,
        productBrand: product.brand,
        productTags: product.tags,
      };

      const priceResult = await this.calculatePrice(tenantId, variantContext, connection.platform);

      let pushed = false;
      let error: string | undefined;

      try {
        if (this.platformRegistry.has(connection.platform)) {
          const adapter = this.platformRegistry.resolve(connection.platform);
          const credentials = connection.credentials as unknown as PlatformCredentials;

          if (listing.platformProductId) {
            const changes: ListingChanges = { price: priceResult.finalPrice };
            await adapter.updateListing(credentials, listing.platformProductId, changes);
            pushed = true;
          }
        }
      } catch (e) {
        error = e.message;
        this.logger.error(
          `Failed to push price for listing ${listing.id} to ${connection.platform}: ${e.message}`,
        );
      }

      results.push({
        listingId: listing.id,
        variantSku: variant.sku,
        platform: connection.platform,
        oldPrice: Number(variant.basePrice),
        newPrice: priceResult.finalPrice,
        pushed,
        error,
      });
    }

    const totalPushed = results.filter((r) => r.pushed).length;
    const totalFailed = results.filter((r) => !r.pushed && r.error).length;

    this.logger.log(
      `Bulk pricing applied for rule ${ruleId}: ${totalPushed} pushed, ${totalFailed} failed, ` +
        `${results.length} total listings`,
    );

    return {
      ruleId,
      totalListings: results.length,
      pushed: totalPushed,
      failed: totalFailed,
      results,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Check if a variant matches the conditions specified in a rule.
   */
  private matchesConditions(
    variant: VariantContext,
    conditions: Record<string, unknown>,
  ): boolean {
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    if (conditions.category && variant.productCategory !== conditions.category) {
      return false;
    }

    if (conditions.brand && variant.productBrand !== conditions.brand) {
      return false;
    }

    if (conditions.minBasePrice && variant.basePrice < (conditions.minBasePrice as number)) {
      return false;
    }

    if (conditions.maxBasePrice && variant.basePrice > (conditions.maxBasePrice as number)) {
      return false;
    }

    if (conditions.skuPattern) {
      const pattern = new RegExp(conditions.skuPattern as string, 'i');
      if (!pattern.test(variant.sku)) {
        return false;
      }
    }

    if (conditions.tags && Array.isArray(conditions.tags)) {
      const requiredTags = conditions.tags as string[];
      const hasTags = requiredTags.some((tag) => variant.productTags.includes(tag));
      if (!hasTags) {
        return false;
      }
    }

    return true;
  }

  /**
   * Apply a single price adjustment.
   */
  private applyAdjustment(
    currentPrice: number,
    adjustment: Adjustment,
    variant: VariantContext,
  ): number {
    const { type, value } = adjustment;

    switch (type) {
      case 'percentage_markup':
        return currentPrice * (1 + value / 100);

      case 'percentage_discount':
        return currentPrice * (1 - value / 100);

      case 'fixed_markup':
        return currentPrice + value;

      case 'fixed_discount':
        return currentPrice - value;

      case 'fixed_price':
        return value;

      case 'margin_on_cost': {
        // Set price to cost * (1 + margin%)
        if (variant.costPrice != null && variant.costPrice > 0) {
          return variant.costPrice * (1 + value / 100);
        }
        // If no cost price, fall through to no change
        return currentPrice;
      }

      case 'round_to': {
        // Round to the nearest value (e.g. round to .99)
        const roundTo = value; // e.g. 0.99
        if (roundTo > 0 && roundTo < 1) {
          return Math.floor(currentPrice) + roundTo;
        }
        // Round to the nearest N (e.g. nearest 5)
        if (roundTo >= 1) {
          return Math.round(currentPrice / roundTo) * roundTo;
        }
        return currentPrice;
      }

      default:
        this.logger.warn(`Unknown adjustment type: ${type}, skipping`);
        return currentPrice;
    }
  }
}
