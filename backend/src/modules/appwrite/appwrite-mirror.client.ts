import { Logger } from '@nestjs/common';
import { Client, Databases } from 'node-appwrite';

type GenericRecord = Record<string, unknown>;

interface AppwriteMirrorConfig {
  enabled: boolean;
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
  collectionPrefix: string;
}

interface AppwriteLikeError {
  code?: number;
  type?: string;
  message?: string;
}

/**
 * Mirrors Prisma write operations to Appwrite collections.
 * PostgreSQL remains the source of truth for all reads.
 */
export class AppwriteMirrorClient {
  private readonly logger = new Logger(AppwriteMirrorClient.name);

  private enabled: boolean;
  private readonly databaseId: string;
  private readonly collectionPrefix: string;
  private readonly missingCollections = new Set<string>();

  private databases: Databases | null = null;

  constructor(config: AppwriteMirrorConfig) {
    this.enabled = config.enabled;
    this.databaseId = config.databaseId;
    this.collectionPrefix = config.collectionPrefix;

    if (!this.enabled) {
      return;
    }

    const missing: string[] = [];
    if (!config.endpoint) missing.push('APPWRITE_ENDPOINT');
    if (!config.projectId) missing.push('APPWRITE_PROJECT_ID');
    if (!config.apiKey) missing.push('APPWRITE_API_KEY');
    if (!config.databaseId) missing.push('APPWRITE_DATABASE_ID');

    if (missing.length > 0) {
      this.logger.warn(
        `Appwrite mirror disabled: missing ${missing.join(', ')}`,
      );
      this.enabled = false;
      return;
    }

    const client = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setKey(config.apiKey);

    this.databases = new Databases(client);

    this.logger.log(
      `Appwrite mirror enabled (database=${this.databaseId}, prefix=${this.collectionPrefix})`,
    );
  }

  static fromEnv(): AppwriteMirrorClient {
    return new AppwriteMirrorClient({
      enabled: process.env.APPWRITE_MIRROR_ENABLED === 'true',
      endpoint: process.env.APPWRITE_ENDPOINT ?? '',
      projectId: process.env.APPWRITE_PROJECT_ID ?? '',
      apiKey: process.env.APPWRITE_API_KEY ?? '',
      databaseId: process.env.APPWRITE_DATABASE_ID ?? '',
      collectionPrefix: process.env.APPWRITE_COLLECTION_PREFIX ?? 'lp_',
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async upsert(modelName: string, record: GenericRecord): Promise<void> {
    if (!this.enabled || !this.databases) {
      return;
    }

    const id = this.extractDocumentId(record);
    if (!id) {
      this.logger.warn(
        `Skipping Appwrite mirror for ${modelName}: missing id field`,
      );
      return;
    }

    const collectionId = this.resolveCollectionId(modelName);
    const payload = this.normalizeRecord(record);

    try {
      await this.databases.updateDocument(
        this.databaseId,
        collectionId,
        id,
        payload,
      );
      return;
    } catch (error) {
      if (this.isCollectionMissing(error)) {
        this.noteMissingCollection(collectionId);
        return;
      }
    }

    try {
      await this.databases.createDocument(
        this.databaseId,
        collectionId,
        id,
        payload,
      );
    } catch (error) {
      if (this.isCollectionMissing(error)) {
        this.noteMissingCollection(collectionId);
        return;
      }

      this.logError('upsert', modelName, error);
    }
  }

  async delete(modelName: string, id: string): Promise<void> {
    if (!this.enabled || !this.databases) {
      return;
    }

    const collectionId = this.resolveCollectionId(modelName);

    try {
      await this.databases.deleteDocument(this.databaseId, collectionId, id);
    } catch (error) {
      if (
        this.isCollectionMissing(error) ||
        this.isNotFound(error)
      ) {
        if (this.isCollectionMissing(error)) {
          this.noteMissingCollection(collectionId);
        }
        return;
      }

      this.logError('delete', modelName, error);
    }
  }

  private resolveCollectionId(modelName: string): string {
    const snake = modelName
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();

    const plural = snake.endsWith('s') ? snake : `${snake}s`;
    return `${this.collectionPrefix}${plural}`;
  }

  private extractDocumentId(record: GenericRecord): string | null {
    const value = record.id;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    return null;
  }

  private normalizeRecord(record: GenericRecord): GenericRecord {
    const normalized = this.normalizeValue(record);
    if (
      normalized &&
      typeof normalized === 'object' &&
      !Array.isArray(normalized)
    ) {
      return normalized as GenericRecord;
    }

    return {};
  }

  private normalizeValue(value: unknown): unknown {
    if (value === null) {
      return null;
    }

    if (value === undefined) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item));
    }

    if (typeof value === 'object') {
      const maybeJson = value as { toJSON?: () => unknown };
      if (typeof maybeJson.toJSON === 'function') {
        const serialized = maybeJson.toJSON();
        if (serialized !== value) {
          return this.normalizeValue(serialized);
        }
      }

      const out: GenericRecord = {};
      for (const [key, nested] of Object.entries(value as GenericRecord)) {
        if (nested === undefined) {
          continue;
        }
        out[key] = this.normalizeValue(nested);
      }
      return out;
    }

    return String(value);
  }

  private noteMissingCollection(collectionId: string): void {
    if (this.missingCollections.has(collectionId)) {
      return;
    }

    this.missingCollections.add(collectionId);
    this.logger.warn(
      `Appwrite collection not found: ${collectionId}. Create it or adjust APPWRITE_COLLECTION_PREFIX.`,
    );
  }

  private logError(action: string, modelName: string, error: unknown): void {
    const details = this.toErrorDetails(error);
    this.logger.warn(
      `Appwrite mirror ${action} failed for ${modelName}: ${details}`,
    );
  }

  private toErrorDetails(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    const maybe = error as AppwriteLikeError;
    if (typeof maybe?.message === 'string') {
      return maybe.message;
    }

    return 'Unknown error';
  }

  private isNotFound(error: unknown): boolean {
    const maybe = error as AppwriteLikeError;
    return maybe?.code === 404;
  }

  private isCollectionMissing(error: unknown): boolean {
    const maybe = error as AppwriteLikeError;
    const type = maybe?.type ?? '';
    const message = maybe?.message ?? '';

    return (
      type.includes('collection_not_found') ||
      message.toLowerCase().includes('collection') &&
        message.toLowerCase().includes('not found')
    );
  }
}
