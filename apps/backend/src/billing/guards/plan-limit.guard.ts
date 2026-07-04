import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PLAN_LIMIT_KEY,
  PlanLimitResource,
} from '../decorators/check-limit.decorator';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { BillingService } from '../billing.service';

@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.getAllAndOverride<PlanLimitResource>(
      PLAN_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!resource) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id: string; organizationId?: string } }>();
    const user = request.user;
    if (!user) {
      return false;
    }

    // Prefer the org already resolved on the JWT payload; only fall back to a DB lookup when
    // it is absent (H8) — the object overload of getRequiredOrg short-circuits when present.
    const organizationId = await this.billingService.getRequiredOrg(user);

    // Fetch subscription
    const subscriptions = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId))
      .limit(1);

    const sub = subscriptions[0];
    let planId = 'free';

    // Treat inactive or past_due subscriptions as free tier
    if (sub && (sub.status === 'active' || sub.status === 'trialing')) {
      planId = sub.planId;
    }

    // Fetch plan limits
    const plans = await this.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);

    const plan = plans[0];

    // Real current usage for this org+resource (computed regardless of plan source).
    const currentCount = await this.countUsage(resource, organizationId);

    let limit: number;
    if (!plan) {
      // Fallback limits if the plans table is unseeded.
      const fallbackLimits: Record<
        string,
        Record<PlanLimitResource, number>
      > = {
        free: { voiceAgents: 1, phoneNumbers: 1, websiteImports: 1 },
        growth: { voiceAgents: 5, phoneNumbers: 3, websiteImports: 10 },
        enterprise: { voiceAgents: 100, phoneNumbers: 50, websiteImports: 100 },
      };
      const limits = fallbackLimits[planId] || fallbackLimits.free;
      limit = limits[resource];
    } else {
      const limitByResource: Record<PlanLimitResource, number> = {
        voiceAgents: plan.voiceAgentsLimit,
        phoneNumbers: plan.phoneNumbersLimit,
        websiteImports: plan.websiteImportsLimit,
      };
      limit = limitByResource[resource];
    }

    this.enforceLimit(resource, currentCount, limit);
    return true;
  }

  /** Resolve the real current usage count for a given limited resource. */
  private async countUsage(
    resource: PlanLimitResource,
    organizationId: string,
  ): Promise<number> {
    switch (resource) {
      case 'voiceAgents':
        return this.countActive(schema.orgAgents, organizationId);
      case 'phoneNumbers':
        return this.countActive(schema.orgPhoneNumbers, organizationId);
      case 'websiteImports':
        // Website imports are a monthly allowance.
        return this.countMonthlyImports(organizationId);
    }
  }

  /** Count non-soft-deleted rows for an org in a table with organizationId + deletedAt. */
  private async countActive(
    table: typeof schema.orgAgents | typeof schema.orgPhoneNumbers,
    organizationId: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(table)
      .where(
        and(eq(table.organizationId, organizationId), isNull(table.deletedAt)),
      );
    return row?.value ?? 0;
  }

  /** Count website-import usage events for the org since the start of the current month. */
  private async countMonthlyImports(organizationId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const [row] = await this.db
      .select({ value: count() })
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.organizationId, organizationId),
          eq(schema.usageEvents.eventType, 'website_import'),
          gte(schema.usageEvents.createdAt, startOfMonth),
        ),
      );
    return row?.value ?? 0;
  }

  private enforceLimit(
    resource: PlanLimitResource,
    count: number,
    limit: number,
  ) {
    if (count >= limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Payment Required',
          message: `Plan limit reached for ${resource}. Current usage: ${count}/${limit}. Please upgrade your subscription.`,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}
