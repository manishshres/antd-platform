import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<import('express').Request & { organizationId?: string }>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey || '')
      .digest('hex');

    const key = await this.db
      .select({
        id: schema.apiKeys.id,
        organizationId: schema.apiKeys.organizationId,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, keyHash))
      .limit(1);

    if (key.length === 0) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach organizationId to request for use in controllers
    request.organizationId = key[0].organizationId;

    // Update last used at in background
    this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, key[0].id))
      .execute()
      .catch(() => {});

    return true;
  }
}
