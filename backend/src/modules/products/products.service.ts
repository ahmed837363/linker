import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';
import { PushProductPayload, PlatformCredentials } from '../platforms/platform.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
  ) {}

  /**
   * Create a product together with its variants in a single transaction.
   */
  async create(tenantId: string, dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      // Check for SKU conflicts within the tenant
      const existingSkus = await tx.productVariant.findMany({
        where: {
          tenantId,
          sku: { in: dto.variants.map((v) => v.sku) },
        },
        select: { sku: true },
      });

      if (existingSkus.length > 0) {
        const duplicates = existingSkus.map((v) => v.sku).join(', ');
        throw new ConflictException(`SKU(s) already exist for this tenant: ${duplicates}`);
      }

      const product = await tx.product.create({
        data: {
          tenantId,
          title: dto.title,
          description: dto.description,
          brand: dto.brand,
          category: dto.category,
          images: (dto.images ?? []) as Prisma.InputJsonValue,
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
          tags: dto.tags ?? [],
          status: 'draft',
          variants: {
            create: dto.variants.map((v) => ({
              tenantId,
              sku: v.sku,
              barcode: v.barcode,
              title: v.title,
              options: (v.options ?? {}) as Prisma.InputJsonValue,
              weightGrams: v.weightGrams,
              basePrice: v.basePrice,
              baseCurrency: v.baseCurrency ?? 'USD',
              costPrice: v.costPrice,
              stockQuantity: v.stockQuantity ?? 0,
              lowStockThreshold: v.lowStockThreshold ?? 5,
            })),
          },
        },
        include: { variants: true },
      });

      this.logger.log(
        `Product created: ${product.id} with ${product.variants.length} variant(s) for tenant ${tenantId}`,
      );

      return product;
    });
  }

  /**
   * List products with pagination, search and status filter.
   */
  async findAll(tenantId: string, query: ProductQueryDto) {
    const { search, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      tenantId,
      status: status ? status : { not: 'archived' },
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          variants: { select: { id: true, sku: true, basePrice: true, stockQuantity: true } },
          _count: { select: { platformListings: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
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
   * Get a single product with its variants and platform listings.
   */
  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        variants: {
          include: {
            platformListings: {
              include: { connection: { select: { id: true, platform: true, shopName: true } } },
            },
          },
        },
        platformListings: {
          include: { connection: { select: { id: true, platform: true, shopName: true } } },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }

  /**
   * Update a product and optionally its variants.
   */
  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    const { variants, ...productData } = dto;

    const updateData: Prisma.ProductUpdateInput = {};

    if (productData.title !== undefined) updateData.title = productData.title;
    if (productData.description !== undefined) updateData.description = productData.description;
    if (productData.brand !== undefined) updateData.brand = productData.brand;
    if (productData.category !== undefined) updateData.category = productData.category;
    if (productData.images !== undefined) updateData.images = productData.images as Prisma.InputJsonValue;
    if (productData.attributes !== undefined)
      updateData.attributes = productData.attributes as Prisma.InputJsonValue;
    if (productData.tags !== undefined) updateData.tags = productData.tags;

    const product = await this.prisma.product.update({
      where: { id },
      data: updateData,
      include: { variants: true },
    });

    this.logger.log(`Product updated: ${id} for tenant ${tenantId}`);
    return product;
  }

  /**
   * Soft-delete a product by setting its status to 'archived'.
   */
  async delete(tenantId: string, id: string) {
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: { status: 'archived' },
    });

    this.logger.log(`Product archived: ${id} for tenant ${tenantId}`);
    return product;
  }

  /**
   * Push a product to a specific connected platform using its adapter.
   */
  async pushToPlatform(tenantId: string, productId: string, connectionId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: { variants: true },
    });

    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }

    const connection = await this.prisma.platformConnection.findFirst({
      where: { id: connectionId, tenantId, status: 'active' },
    });

    if (!connection) {
      throw new NotFoundException(`Active connection ${connectionId} not found`);
    }

    const adapter = this.platformRegistry.resolve(connection.platform);
    const credentials = connection.credentials as unknown as PlatformCredentials;

    const payload: PushProductPayload = {
      title: product.title,
      description: product.description ?? undefined,
      brand: product.brand ?? undefined,
      category: product.category ?? undefined,
      tags: product.tags,
      images: Array.isArray(product.images) ? (product.images as any[]) : [],
      variants: product.variants.map((v) => ({
        sku: v.sku,
        barcode: v.barcode ?? undefined,
        title: v.title ?? undefined,
        options: (v.options as Record<string, string>) ?? {},
        price: Number(v.basePrice),
        currency: v.baseCurrency,
        costPrice: v.costPrice ? Number(v.costPrice) : undefined,
        weightGrams: v.weightGrams ?? undefined,
        stockQuantity: v.stockQuantity,
      })),
    };

    try {
      const result = await adapter.pushProduct(credentials, payload);

      // Create or update platform listings for each variant
      await this.prisma.$transaction(
        product.variants.map((variant, index) =>
          this.prisma.platformListing.upsert({
            where: {
              connectionId_platformProductId_platformVariantId: {
                connectionId: connection.id,
                platformProductId: result.platformProductId,
                platformVariantId: result.platformVariantIds[index] ?? '',
              },
            },
            create: {
              tenantId,
              productId: product.id,
              variantId: variant.id,
              connectionId: connection.id,
              platform: connection.platform,
              platformProductId: result.platformProductId,
              platformVariantId: result.platformVariantIds[index] ?? null,
              platformSku: variant.sku,
              listingStatus: 'active',
              lastPushedAt: new Date(),
            },
            update: {
              platformProductId: result.platformProductId,
              platformVariantId: result.platformVariantIds[index] ?? null,
              listingStatus: 'active',
              lastPushedAt: new Date(),
            },
          }),
        ),
      );

      this.logger.log(
        `Product ${productId} pushed to ${connection.platform} (connection ${connectionId})`,
      );

      return {
        productId,
        connectionId,
        platform: connection.platform,
        platformProductId: result.platformProductId,
        platformVariantIds: result.platformVariantIds,
      };
    } catch (error) {
      this.logger.error(
        `Failed to push product ${productId} to ${connection.platform}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to push product to ${connection.platform}: ${error.message}`,
      );
    }
  }

  /**
   * Push a product to all active connected platforms for the tenant.
   */
  async pushToAllPlatforms(tenantId: string, productId: string) {
    const connections = await this.prisma.platformConnection.findMany({
      where: { tenantId, status: 'active' },
    });

    if (connections.length === 0) {
      throw new NotFoundException('No active platform connections found for this tenant');
    }

    const results: { connectionId: string; platform: string; success: boolean; error?: string }[] = [];

    for (const connection of connections) {
      try {
        await this.pushToPlatform(tenantId, productId, connection.id);
        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: true,
        });
      } catch (error) {
        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: false,
          error: error.message,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    this.logger.log(
      `Push-all for product ${productId}: ${succeeded} succeeded, ${failed} failed`,
    );

    return { productId, results, summary: { total: results.length, succeeded, failed } };
  }
}
