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

@Injectable()
export class OrgStatusGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: CurrentUserPayload }>().user;

    if (!user?.organizationId) return true; // platform_admin passes through

    const [org] = await this.db
      .select({ status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, user.organizationId))
      .limit(1);

    if (!org || org.status === 'suspended' || org.status === 'archived') {
      throw new ForbiddenException('Organization is suspended or archived.');
    }
    return true;
  }
}
