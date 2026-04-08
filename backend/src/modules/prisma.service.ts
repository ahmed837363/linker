import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppwriteMirrorClient } from './appwrite/appwrite-mirror.client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private readonly appwriteMirror = AppwriteMirrorClient.fromEnv();

  constructor() {
    super();
    this.registerAppwriteMirrorMiddleware();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to the database');
    } catch (error) {
      this.logger.error('Failed to connect to the database', error);
      throw error;
    }
  }

  private registerAppwriteMirrorMiddleware(): void {
    if (!this.appwriteMirror.isEnabled()) {
      return;
    }

    this.$use(async (params: Prisma.MiddlewareParams, next) => {
      const result = await next(params);

      if (!params.model) {
        return result;
      }

      if (
        params.action === 'create' ||
        params.action === 'update' ||
        params.action === 'upsert'
      ) {
        const record = this.asRecord(result);
        if (record) {
          void this.appwriteMirror.upsert(params.model, record);
        }
        return result;
      }

      if (params.action === 'delete') {
        const id = this.resolveDeleteId(params, result);
        if (id) {
          void this.appwriteMirror.delete(params.model, id);
        }
        return result;
      }

      if (
        params.action === 'createMany' ||
        params.action === 'updateMany' ||
        params.action === 'deleteMany'
      ) {
        this.logger.debug(
          `[Appwrite mirror] ${params.model}.${params.action} is skipped automatically.`,
        );
      }

      return result;
    });
  }

  private resolveDeleteId(
    params: Prisma.MiddlewareParams,
    result: unknown,
  ): string | null {
    const resultRecord = this.asRecord(result);
    const resultId = resultRecord?.id;

    if (typeof resultId === 'string' && resultId.length > 0) {
      return resultId;
    }

    if (typeof resultId === 'number') {
      return resultId.toString();
    }

    const argsRecord = this.asRecord(params.args);
    const whereRecord = this.asRecord(argsRecord?.where);
    const whereId = whereRecord?.id;

    if (typeof whereId === 'string' && whereId.length > 0) {
      return whereId;
    }

    if (typeof whereId === 'number') {
      return whereId.toString();
    }

    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }
}
