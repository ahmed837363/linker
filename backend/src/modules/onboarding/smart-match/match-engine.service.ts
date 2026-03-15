import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors stored as
 * comma-separated strings (our lightweight pgvector alternative).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Parse a comma-separated embedding string back into a number array. */
function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    return raw.split(',').map(Number);
  } catch {
    return null;
  }
}

/** Serialise an embedding vector to a comma-separated string for DB storage. */
function serializeEmbedding(vec: number[]): string {
  return vec.join(',');
}

/**
 * Normalised price proximity in [0, 1].
 * Returns 1 when prices are identical, approaching 0 as they diverge.
 */
function priceProximity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const max = Math.max(Math.abs(a), Math.abs(b));
  return 1 - Math.abs(a - b) / max;
}

/**
 * Attribute overlap score in [0, 1].
 * Counts how many shared keys have the same (lowercased) value.
 */
function attributeOverlap(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const keysA = Object.keys(a);
  const keysB = new Set(Object.keys(b));
  const shared = keysA.filter((k) => keysB.has(k));

  if (shared.length === 0) return 0;

  let matches = 0;
  for (const key of shared) {
    if (
      String(a[key]).toLowerCase().trim() ===
      String(b[key]).toLowerCase().trim()
    ) {
      matches++;
    }
  }

  return matches / shared.length;
}

// ── Scoring weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  barcode: 0.2,
  text: 0.3,
  image: 0.3,
  price: 0.1,
  attributes: 0.1,
} as const;

const MAX_CANDIDATES = 5;

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MatchEngineService {
  private readonly logger = new Logger(MatchEngineService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('openai.apiKey'),
    });
  }

  // ── Text embeddings ──────────────────────────────────────────────────────

  /**
   * Generate text embeddings for every OnboardingProduct in the session
   * that does not already have one.
   */
  async generateEmbeddings(sessionId: string): Promise<void> {
    const products = await this.prisma.onboardingProduct.findMany({
      where: { sessionId, textEmbedding: null },
    });

    this.logger.log(
      `Generating text embeddings for ${products.length} products (session ${sessionId})`,
    );

    // Process in batches of 50 to respect rate limits
    const batchSize = 50;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);

      const inputs = batch.map((p) => {
        const parts: string[] = [];
        if (p.title) parts.push(p.title);
        if (p.sku) parts.push(`SKU: ${p.sku}`);
        if (p.barcode) parts.push(`Barcode: ${p.barcode}`);
        if (p.description) parts.push(p.description.slice(0, 500));

        const attrs = p.attributes as Record<string, unknown>;
        if (attrs && typeof attrs === 'object') {
          for (const [key, value] of Object.entries(attrs)) {
            parts.push(`${key}: ${String(value)}`);
          }
        }

        return parts.join(' | ') || 'empty product';
      });

      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputs,
      });

      const updates = batch.map((product, idx) =>
        this.prisma.onboardingProduct.update({
          where: { id: product.id },
          data: {
            textEmbedding: serializeEmbedding(
              response.data[idx].embedding,
            ),
          },
        }),
      );

      await this.prisma.$transaction(updates);

      this.logger.debug(
        `Text embeddings batch ${Math.floor(i / batchSize) + 1} complete`,
      );
    }

    this.logger.log(
      `Text embedding generation complete for session ${sessionId}`,
    );
  }

  // ── Image embeddings ─────────────────────────────────────────────────────

  /**
   * For each product's primary image, describe it via GPT-4o vision
   * then embed the description using text-embedding-3-small.
   */
  async generateImageEmbeddings(sessionId: string): Promise<void> {
    const products = await this.prisma.onboardingProduct.findMany({
      where: { sessionId, imageEmbedding: null },
    });

    this.logger.log(
      `Generating image embeddings for ${products.length} products (session ${sessionId})`,
    );

    for (const product of products) {
      try {
        const imageUrls = product.imageUrls as string[];
        if (!imageUrls || imageUrls.length === 0) continue;

        const primaryImage = imageUrls[0];

        // Step 1: Describe the image using GPT-4o vision
        const visionResponse = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Describe this product image concisely for the purpose of matching it with the same product across different e-commerce platforms. Focus on: product type, brand indicators, color, shape, size cues, packaging, and any visible text or logos.',
                },
                {
                  type: 'image_url',
                  image_url: { url: primaryImage, detail: 'low' },
                },
              ],
            },
          ],
        });

        const description =
          visionResponse.choices[0]?.message?.content ?? '';

        if (!description) continue;

        // Step 2: Embed the description
        const embeddingResponse = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: description,
        });

        await this.prisma.onboardingProduct.update({
          where: { id: product.id },
          data: {
            imageEmbedding: serializeEmbedding(
              embeddingResponse.data[0].embedding,
            ),
          },
        });
      } catch (error) {
        this.logger.warn(
          `Image embedding failed for product ${product.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Continue with remaining products
      }
    }

    this.logger.log(
      `Image embedding generation complete for session ${sessionId}`,
    );
  }

  // ── Candidate finding ────────────────────────────────────────────────────

  /**
   * For a single anchor product, find the top N candidates from
   * other stores and persist them as MatchCandidate records.
   */
  async findCandidates(
    sessionId: string,
    anchorProductId: string,
  ): Promise<void> {
    const anchor = await this.prisma.onboardingProduct.findUniqueOrThrow({
      where: { id: anchorProductId },
    });

    // Candidates must come from a DIFFERENT connection (i.e. different store)
    const candidates = await this.prisma.onboardingProduct.findMany({
      where: {
        sessionId,
        connectionId: { not: anchor.connectionId },
      },
    });

    if (candidates.length === 0) return;

    const anchorTextEmbed = parseEmbedding(anchor.textEmbedding);
    const anchorImageEmbed = parseEmbedding(anchor.imageEmbedding);
    const anchorPrice = anchor.price ? Number(anchor.price) : 0;
    const anchorAttrs = (anchor.attributes ?? {}) as Record<string, unknown>;

    const scored = candidates.map((candidate) => {
      // 1. Barcode exact match
      const barcodeMatch =
        !!anchor.barcode &&
        !!candidate.barcode &&
        anchor.barcode.trim().toLowerCase() ===
          candidate.barcode.trim().toLowerCase();

      // 2. Text embedding cosine similarity
      const candidateTextEmbed = parseEmbedding(candidate.textEmbedding);
      const textSim =
        anchorTextEmbed && candidateTextEmbed
          ? cosineSimilarity(anchorTextEmbed, candidateTextEmbed)
          : 0;

      // 3. Image embedding cosine similarity
      const candidateImageEmbed = parseEmbedding(candidate.imageEmbedding);
      const imageSim =
        anchorImageEmbed && candidateImageEmbed
          ? cosineSimilarity(anchorImageEmbed, candidateImageEmbed)
          : 0;

      // 4. Price proximity
      const candidatePrice = candidate.price ? Number(candidate.price) : 0;
      const priceSim =
        anchorPrice > 0 && candidatePrice > 0
          ? priceProximity(anchorPrice, candidatePrice)
          : 0;

      // 5. Attribute overlap
      const candidateAttrs = (candidate.attributes ?? {}) as Record<
        string,
        unknown
      >;
      const attrScore = attributeOverlap(anchorAttrs, candidateAttrs);

      // Composite score
      const composite =
        (barcodeMatch ? 1 : 0) * WEIGHTS.barcode +
        textSim * WEIGHTS.text +
        imageSim * WEIGHTS.image +
        priceSim * WEIGHTS.price +
        attrScore * WEIGHTS.attributes;

      return {
        candidateId: candidate.id,
        barcodeMatch,
        textSim,
        imageSim,
        priceSim,
        composite,
      };
    });

    // Sort descending by composite score and take top N
    scored.sort((a, b) => b.composite - a.composite);
    const topCandidates = scored.slice(0, MAX_CANDIDATES);

    // Remove existing candidates for this anchor (in case of re-run)
    await this.prisma.matchCandidate.deleteMany({
      where: { sessionId, anchorProductId },
    });

    // Persist as MatchCandidate records
    const creates = topCandidates.map((c, idx) =>
      this.prisma.matchCandidate.create({
        data: {
          sessionId,
          anchorProductId,
          candidateProductId: c.candidateId,
          rank: idx + 1,
          textSimilarity: c.textSim,
          imageSimilarity: c.imageSim,
          barcodeMatch: c.barcodeMatch,
          priceProximity: c.priceSim,
          compositeScore: c.composite,
          status: 'pending',
        },
      }),
    );

    await this.prisma.$transaction(creates);
  }

  // ── Vision comparison ────────────────────────────────────────────────────

  /**
   * Send both product images and metadata to GPT-4o and ask whether
   * they are the same product. Store the result in visionAnalysis JSONB.
   */
  async runVisionComparison(
    anchorProductId: string,
    candidateProductId: string,
  ): Promise<void> {
    const [anchor, candidate] = await Promise.all([
      this.prisma.onboardingProduct.findUniqueOrThrow({
        where: { id: anchorProductId },
      }),
      this.prisma.onboardingProduct.findUniqueOrThrow({
        where: { id: candidateProductId },
      }),
    ]);

    const anchorImages = (anchor.imageUrls as string[]) ?? [];
    const candidateImages = (candidate.imageUrls as string[]) ?? [];

    if (anchorImages.length === 0 && candidateImages.length === 0) {
      return;
    }

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
      [
        {
          type: 'text',
          text: [
            'You are a product matching expert. Determine if these two product listings represent the SAME physical product.',
            '',
            `Product A: "${anchor.title ?? 'Unknown'}"`,
            `  SKU: ${anchor.sku ?? 'N/A'} | Barcode: ${anchor.barcode ?? 'N/A'}`,
            `  Price: ${anchor.price ? `${anchor.currency ?? 'USD'} ${anchor.price}` : 'N/A'}`,
            '',
            `Product B: "${candidate.title ?? 'Unknown'}"`,
            `  SKU: ${candidate.sku ?? 'N/A'} | Barcode: ${candidate.barcode ?? 'N/A'}`,
            `  Price: ${candidate.price ? `${candidate.currency ?? 'USD'} ${candidate.price}` : 'N/A'}`,
            '',
            'Respond with JSON only:',
            '{ "sameProduct": true/false, "confidence": 0-100, "reasoning": "brief explanation" }',
          ].join('\n'),
        },
      ];

    if (anchorImages[0]) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: anchorImages[0], detail: 'low' },
      });
    }

    if (candidateImages[0]) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: candidateImages[0], detail: 'low' },
      });
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: contentParts }],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      let analysis: Record<string, unknown>;
      try {
        analysis = JSON.parse(raw);
      } catch {
        analysis = { raw, parseError: true };
      }

      // Persist on the MatchCandidate row
      await this.prisma.matchCandidate.updateMany({
        where: {
          anchorProductId,
          candidateProductId,
        },
        data: { visionAnalysis: analysis as any },
      });
    } catch (error) {
      this.logger.warn(
        `Vision comparison failed for ${anchorProductId} vs ${candidateProductId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Orchestrator ─────────────────────────────────────────────────────────

  /**
   * Run findCandidates for every anchor product, then runVisionComparison
   * for the top-ranked candidate of each anchor.
   */
  async generateAllCandidates(sessionId: string): Promise<void> {
    const session =
      await this.prisma.onboardingSession.findUniqueOrThrow({
        where: { id: sessionId },
      });

    // Anchor products belong to the anchor connection
    const anchorProducts = await this.prisma.onboardingProduct.findMany({
      where: { sessionId, connectionId: session.anchorConnectionId! },
    });

    this.logger.log(
      `Running candidate search for ${anchorProducts.length} anchor products (session ${sessionId})`,
    );

    // Phase 1: Find candidates for each anchor product
    for (const anchor of anchorProducts) {
      await this.findCandidates(sessionId, anchor.id);
    }

    // Phase 2: Run vision comparison on top candidate for each anchor
    const topCandidates = await this.prisma.matchCandidate.findMany({
      where: { sessionId, rank: 1 },
    });

    this.logger.log(
      `Running vision comparison for ${topCandidates.length} top candidates`,
    );

    for (const mc of topCandidates) {
      await this.runVisionComparison(
        mc.anchorProductId,
        mc.candidateProductId,
      );
    }

    // Update total products count on session
    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { totalProducts: anchorProducts.length },
    });

    this.logger.log(
      `All candidate generation complete for session ${sessionId}`,
    );
  }
}
