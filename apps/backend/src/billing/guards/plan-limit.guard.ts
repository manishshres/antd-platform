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
import { eq } from 'drizzle-orm';
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

    // Get or create organization
    const organizationId = await this.billingService.getRequiredOrg(user.id);

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
    if (!plan) {
      // Fallback fallback limits if plans table is unseeded
      const fallbackLimits: Record<
        string,
        Record<PlanLimitResource, number>
      > = {
        free: { voiceAgents: 1, phoneNumbers: 1, websiteImports: 1 },
        growth: { voiceAgents: 5, phoneNumbers: 3, websiteImports: 10 },
        enterprise: { voiceAgents: 100, phoneNumbers: 50, websiteImports: 100 },
      };

      const limits = fallbackLimits[planId] || fallbackLimits.free;
      this.enforceLimit(resource, 0, limits[resource]);
      return true;
    }

    // Determine limit and count
    let limit = 0;
    let currentCount = 0;

    switch (resource) {
      case 'voiceAgents':
        limit = plan.voiceAgentsLimit;
        // Mock count for Phase 2 (since voice agents table is created in Phase 3)
        currentCount = 0;
        break;
      case 'phoneNumbers':
        limit = plan.phoneNumbersLimit;
        // Mock count for Phase 2
        currentCount = 0;
        break;
      case 'websiteImports':
        limit = plan.websiteImportsLimit;
        // Mock count for Phase 2
        currentCount = 0;
        break;
    }

    this.enforceLimit(resource, currentCount, limit);
    return true;
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
