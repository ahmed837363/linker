import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PlatformAdapter, PlatformType } from './platform.interface';

/**
 * Multi-provider token. Every adapter registers itself under this token
 * so they are all collected into a single array at injection time.
 */
export const PLATFORM_ADAPTERS = Symbol('PLATFORM_ADAPTERS');

/**
 * Central registry that allows resolving a `PlatformAdapter` by its
 * `PlatformType` key at runtime.
 *
 * All adapters are injected via the `PLATFORM_ADAPTERS` multi-provider
 * token and indexed on initialisation.
 */
@Injectable()
export class PlatformRegistry implements OnModuleInit {
  private readonly logger = new Logger(PlatformRegistry.name);
  private readonly adapters = new Map<PlatformType, PlatformAdapter>();

  constructor(
    @Inject(PLATFORM_ADAPTERS)
    private readonly registeredAdapters: PlatformAdapter[],
  ) {}

  onModuleInit(): void {
    for (const adapter of this.registeredAdapters) {
      if (this.adapters.has(adapter.platformKey)) {
        this.logger.warn(
          `Duplicate adapter registration for "${adapter.platformKey}" -- overwriting.`,
        );
      }
      this.adapters.set(adapter.platformKey, adapter);
      this.logger.log(
        `Registered platform adapter: ${adapter.displayName} (${adapter.platformKey})`,
      );
    }
    this.logger.log(
      `Platform registry initialised with ${this.adapters.size} adapter(s).`,
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Resolve an adapter or throw if none is registered. */
  resolve(platform: PlatformType): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(
        `No adapter registered for platform "${platform}". ` +
          `Available: [${[...this.adapters.keys()].join(', ')}]`,
      );
    }
    return adapter;
  }

  /** Resolve an adapter or return `undefined`. */
  tryResolve(platform: PlatformType): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  /** Check whether an adapter is available for a given platform. */
  has(platform: PlatformType): boolean {
    return this.adapters.has(platform);
  }

  /** Return all currently registered platform keys. */
  registeredKeys(): PlatformType[] {
    return [...this.adapters.keys()];
  }

  /** Return metadata for every registered adapter (useful for the storefront picker UI). */
  listAdapters(): {
    platformKey: PlatformType;
    displayName: string;
    logoUrl: string;
    authType: string;
  }[] {
    return [...this.adapters.values()].map((a) => ({
      platformKey: a.platformKey,
      displayName: a.displayName,
      logoUrl: a.logoUrl,
      authType: a.authType,
    }));
  }
}
