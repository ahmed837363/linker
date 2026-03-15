import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../prisma.service';
import { PlatformRegistry } from '../platforms/platform.registry';
import type { ImportJobData } from './processors/import.processor';

type SwipeAction = 'accept' | 'reject' | 'skip';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRegistry: PlatformRegistry,
    @InjectQueue('onboarding:import')
    private readonly importQueue: Queue,
  ) {}

  // ── Session lifecycle ────────────────────────────────────────────────────

  /**
   * Create an OnboardingSession, detect the anchor store (the one with the
   * most products already synced, or the first active connection), and kick
   * off import jobs for all connected stores.
   */
  async startSession(tenantId: string) {
    // Fetch all active platform connections for this tenant
    const connections = await this.prisma.platformConnection.findMany({
      where: { tenantId, status: 'active' },
    });

    if (connections.length < 2) {
      throw new BadRequestException(
        'At least two connected stores are required to start onboarding. ' +
          `Currently connected: ${connections.length}.`,
      );
    }

    // Determine anchor store: pick the connection that already has the
    // most PlatformListings (i.e. most products). Falls back to first.
    const listingCounts = await this.prisma.platformListing.groupBy({
      by: ['connectionId'],
      where: {
        tenantId,
        connectionId: { in: connections.map((c) => c.id) },
      },
      _count: { id: true },
    });

    const countMap = new Map(
      listingCounts.map((lc) => [lc.connectionId, lc._count.id]),
    );

    const sortedConnections = [...connections].sort(
      (a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0),
    );

    const anchorConnection = sortedConnections[0];

    // Create the session
    const session = await this.prisma.onboardingSession.create({
      data: {
        tenantId,
        status: 'importing',
        anchorConnectionId: anchorConnection.id,
      },
    });

    this.logger.log(
      `Onboarding session ${session.id} created for tenant ${tenantId}. ` +
        `Anchor: ${anchorConnection.shopName ?? anchorConnection.platform} (${anchorConnection.id}). ` +
        `Importing from ${connections.length} stores.`,
    );

    // Kick off import jobs for each connection
    const jobs = connections.map((conn) => {
      const data: ImportJobData = {
        sessionId: session.id,
        tenantId,
        connectionId: conn.id,
        platform: conn.platform,
      };

      return this.importQueue.add('import', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
    });

    await Promise.all(jobs);

    return session;
  }

  /**
   * Get session with progress statistics.
   */
  async getSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.onboardingSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        anchorConnection: {
          select: { id: true, platform: true, shopName: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(
        `Onboarding session ${sessionId} not found`,
      );
    }

    // Count imported products per connection
    const productCounts = await this.prisma.onboardingProduct.groupBy({
      by: ['connectionId'],
      where: { sessionId },
      _count: { id: true },
    });

    // Count pending match candidates
    const pendingCandidates = await this.prisma.matchCandidate.count({
      where: { sessionId, status: 'pending' },
    });

    return {
      ...session,
      importedProducts: productCounts,
      pendingCandidates,
    };
  }

  // ── Swipe-based matching ─────────────────────────────────────────────────

  /**
   * Get the next pending match candidate pair with full product details
   * (images, title, price, sku) for both the anchor and candidate side.
   */
  async getNextMatch(tenantId: string, sessionId: string) {
    // Validate session belongs to tenant
    const session = await this.prisma.onboardingSession.findFirst({
      where: { id: sessionId, tenantId },
    });

    if (!session) {
      throw new NotFoundException(
        `Onboarding session ${sessionId} not found`,
      );
    }

    if (session.status !== 'ready') {
      return {
        status: session.status,
        match: null,
        message: `Session is not ready for matching yet. Current status: ${session.status}`,
      };
    }

    // Find the next pending match candidate, ordered by anchor product
    // and then by rank (so we present the best candidate first)
    const candidate = await this.prisma.matchCandidate.findFirst({
      where: { sessionId, status: 'pending' },
      orderBy: [
        { anchorProductId: 'asc' },
        { rank: 'asc' },
      ],
      include: {
        anchorProduct: true,
        candidateProduct: true,
      },
    });

    if (!candidate) {
      return {
        status: 'no_more_matches',
        match: null,
        message: 'All matches have been processed.',
      };
    }

    return {
      status: 'ready',
      match: {
        matchCandidateId: candidate.id,
        compositeScore: candidate.compositeScore,
        barcodeMatch: candidate.barcodeMatch,
        textSimilarity: candidate.textSimilarity,
        imageSimilarity: candidate.imageSimilarity,
        priceProximity: candidate.priceProximity,
        visionAnalysis: candidate.visionAnalysis,
        rank: candidate.rank,
        anchor: {
          id: candidate.anchorProduct.id,
          platform: candidate.anchorProduct.platform,
          platformProductId: candidate.anchorProduct.platformProductId,
          title: candidate.anchorProduct.title,
          description: candidate.anchorProduct.description,
          price: candidate.anchorProduct.price,
          currency: candidate.anchorProduct.currency,
          sku: candidate.anchorProduct.sku,
          barcode: candidate.anchorProduct.barcode,
          imageUrls: candidate.anchorProduct.imageUrls,
          attributes: candidate.anchorProduct.attributes,
        },
        candidate: {
          id: candidate.candidateProduct.id,
          platform: candidate.candidateProduct.platform,
          platformProductId: candidate.candidateProduct.platformProductId,
          title: candidate.candidateProduct.title,
          description: candidate.candidateProduct.description,
          price: candidate.candidateProduct.price,
          currency: candidate.candidateProduct.currency,
          sku: candidate.candidateProduct.sku,
          barcode: candidate.candidateProduct.barcode,
          imageUrls: candidate.candidateProduct.imageUrls,
          attributes: candidate.candidateProduct.attributes,
        },
      },
    };
  }

  /**
   * Process a user's swipe action on a match candidate.
   *
   * - accept: Create canonical Product + ProductVariant, link both sides
   *   as PlatformListings. Update session.matchedCount.
   * - reject: Mark candidate as rejected, find next candidate for the same
   *   anchor product. If none left, mark anchor as unmatched.
   * - skip: Mark as skipped, move to next anchor product.
   */
  async handleSwipe(
    tenantId: string,
    sessionId: string,
    matchCandidateId: string,
    action: SwipeAction,
  ) {
    const candidate = await this.prisma.matchCandidate.findFirst({
      where: { id: matchCandidateId, sessionId },
      include: {
        anchorProduct: { include: { connection: true } },
        candidateProduct: { include: { connection: true } },
      },
    });

    if (!candidate) {
      throw new NotFoundException(
        `Match candidate ${matchCandidateId} not found in session ${sessionId}`,
      );
    }

    if (candidate.status !== 'pending') {
      throw new BadRequestException(
        `Match candidate ${matchCandidateId} has already been processed (status: ${candidate.status})`,
      );
    }

    switch (action) {
      case 'accept':
        return this.acceptMatch(tenantId, sessionId, candidate);
      case 'reject':
        return this.rejectMatch(sessionId, candidate);
      case 'skip':
        return this.skipMatch(sessionId, candidate);
      default:
        throw new BadRequestException(`Unknown action: ${action}`);
    }
  }

  private async acceptMatch(
    tenantId: string,
    sessionId: string,
    candidate: any,
  ) {
    const anchor = candidate.anchorProduct;
    const matched = candidate.candidateProduct;

    // Create canonical Product
    const product = await this.prisma.product.create({
      data: {
        tenantId,
        title: anchor.title ?? matched.title ?? 'Untitled Product',
        description: anchor.description ?? matched.description ?? null,
        brand:
          (anchor.attributes as any)?.brand ??
          (matched.attributes as any)?.brand ??
          null,
        category:
          (anchor.attributes as any)?.category ??
          (matched.attributes as any)?.category ??
          null,
        images: anchor.imageUrls ?? [],
        tags: [],
        status: 'active',
      },
    });

    // Create canonical ProductVariant
    const sku =
      anchor.sku ??
      matched.sku ??
      `LP-${product.id.slice(0, 8).toUpperCase()}`;

    const variant = await this.prisma.productVariant.create({
      data: {
        tenantId,
        productId: product.id,
        sku,
        barcode: anchor.barcode ?? matched.barcode ?? null,
        title: anchor.title ?? matched.title ?? null,
        basePrice: anchor.price ?? matched.price ?? 0,
        baseCurrency: anchor.currency ?? matched.currency ?? 'USD',
        stockQuantity: 0,
      },
    });

    // Create PlatformListing for anchor side
    await this.prisma.platformListing.create({
      data: {
        tenantId,
        productId: product.id,
        variantId: variant.id,
        connectionId: anchor.connectionId,
        platform: anchor.platform,
        platformProductId: anchor.platformProductId,
        platformSku: anchor.sku,
        listingStatus: 'active',
      },
    });

    // Create PlatformListing for candidate side
    await this.prisma.platformListing.create({
      data: {
        tenantId,
        productId: product.id,
        variantId: variant.id,
        connectionId: matched.connectionId,
        platform: matched.platform,
        platformProductId: matched.platformProductId,
        platformSku: matched.sku,
        listingStatus: 'active',
      },
    });

    // Mark this candidate as accepted
    await this.prisma.matchCandidate.update({
      where: { id: candidate.id },
      data: { status: 'accepted', decidedAt: new Date() },
    });

    // Mark all other candidates for this anchor product as superseded
    await this.prisma.matchCandidate.updateMany({
      where: {
        sessionId,
        anchorProductId: anchor.id,
        id: { not: candidate.id },
        status: 'pending',
      },
      data: { status: 'superseded', decidedAt: new Date() },
    });

    // Increment matched count
    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { matchedCount: { increment: 1 } },
    });

    this.logger.log(
      `Match accepted: anchor ${anchor.id} <-> candidate ${matched.id} => product ${product.id}`,
    );

    return {
      action: 'accepted',
      productId: product.id,
      variantId: variant.id,
    };
  }

  private async rejectMatch(sessionId: string, candidate: any) {
    // Mark this candidate as rejected
    await this.prisma.matchCandidate.update({
      where: { id: candidate.id },
      data: { status: 'rejected', decidedAt: new Date() },
    });

    // Check if there are remaining pending candidates for this anchor
    const remaining = await this.prisma.matchCandidate.count({
      where: {
        sessionId,
        anchorProductId: candidate.anchorProductId,
        status: 'pending',
      },
    });

    if (remaining === 0) {
      // No more candidates: mark anchor as unmatched
      await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { unmatchedCount: { increment: 1 } },
      });

      this.logger.log(
        `All candidates exhausted for anchor ${candidate.anchorProductId} -- marked unmatched`,
      );

      return { action: 'rejected', remaining: 0, anchorUnmatched: true };
    }

    return { action: 'rejected', remaining, anchorUnmatched: false };
  }

  private async skipMatch(sessionId: string, candidate: any) {
    // Mark all candidates for this anchor product as skipped
    await this.prisma.matchCandidate.updateMany({
      where: {
        sessionId,
        anchorProductId: candidate.anchorProductId,
        status: 'pending',
      },
      data: { status: 'skipped', decidedAt: new Date() },
    });

    // Increment skipped count
    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { skippedCount: { increment: 1 } },
    });

    this.logger.log(
      `Anchor product ${candidate.anchorProductId} skipped`,
    );

    return { action: 'skipped' };
  }

  // ── Session completion ───────────────────────────────────────────────────

  /**
   * Finalize the onboarding session, clean up temporary onboarding data.
   */
  async completeSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.onboardingSession.findFirst({
      where: { id: sessionId, tenantId },
    });

    if (!session) {
      throw new NotFoundException(
        `Onboarding session ${sessionId} not found`,
      );
    }

    // Count any remaining pending candidates and mark them unmatched
    const remainingAnchors = await this.prisma.matchCandidate.findMany({
      where: { sessionId, status: 'pending' },
      distinct: ['anchorProductId'],
      select: { anchorProductId: true },
    });

    if (remainingAnchors.length > 0) {
      // Mark all remaining pending candidates as expired
      await this.prisma.matchCandidate.updateMany({
        where: { sessionId, status: 'pending' },
        data: { status: 'expired', decidedAt: new Date() },
      });

      // Add to unmatched count
      await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: {
          unmatchedCount: { increment: remainingAnchors.length },
        },
      });
    }

    // Finalize session
    const completedSession = await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Onboarding session ${sessionId} completed. ` +
        `Matched: ${completedSession.matchedCount}, ` +
        `Skipped: ${completedSession.skippedCount}, ` +
        `Unmatched: ${completedSession.unmatchedCount}`,
    );

    return completedSession;
  }

  /**
   * Return summary stats: matched, skipped, unmatched, and per-store
   * "only on X" counts.
   */
  async getSessionSummary(tenantId: string, sessionId: string) {
    const session = await this.prisma.onboardingSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        anchorConnection: {
          select: { id: true, platform: true, shopName: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(
        `Onboarding session ${sessionId} not found`,
      );
    }

    // Products only on anchor store (no accepted match)
    const anchorProducts = await this.prisma.onboardingProduct.count({
      where: { sessionId, connectionId: session.anchorConnectionId! },
    });

    // Products only on other stores (never appeared as a candidate in
    // an accepted match)
    const otherProducts = await this.prisma.onboardingProduct.count({
      where: {
        sessionId,
        connectionId: { not: session.anchorConnectionId! },
      },
    });

    // Per-connection breakdown
    const perConnection = await this.prisma.onboardingProduct.groupBy({
      by: ['connectionId', 'platform'],
      where: { sessionId },
      _count: { id: true },
    });

    return {
      sessionId: session.id,
      status: session.status,
      totalProducts: session.totalProducts,
      matched: session.matchedCount,
      skipped: session.skippedCount,
      unmatched: session.unmatchedCount,
      anchorStore: {
        connectionId: session.anchorConnectionId,
        platform: session.anchorConnection?.platform,
        shopName: session.anchorConnection?.shopName,
        productCount: anchorProducts,
      },
      otherStoreProductCount: otherProducts,
      perConnection: perConnection.map((pc) => ({
        connectionId: pc.connectionId,
        platform: pc.platform,
        productCount: pc._count.id,
      })),
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    };
  }
}
