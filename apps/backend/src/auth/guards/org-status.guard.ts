import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import * as schema from '../../database/schema';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class OrgStatusGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: CurrentUserPayload }>().user;

    if (!user?.organizationId) return true; // platform_admin passes through

    const cacheKey = `org_status:${user.organizationId}`;
    let status = await this.cacheManager.get<string>(cacheKey);

    if (!status) {
      const [org] = await this.db
        .select({ status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, user.organizationId))
        .limit(1);

      status = org?.status || 'not_found';
      await this.cacheManager.set(cacheKey, status, 30_000);
    }

    if (status === 'not_found' || status === 'suspended' || status === 'archived') {
      throw new ForbiddenException('Organization is suspended or archived.');
    }
    return true;
  }
}
