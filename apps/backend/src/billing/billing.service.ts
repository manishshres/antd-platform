import {
  Injectable,
  Inject,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { StripeService } from '../stripe/stripe.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CheckoutDto } from './dto/checkout.dto';
import Stripe from 'stripe';
import { randomBytes, createHash } from 'crypto';
import { TelnyxService } from '../telnyx/telnyx.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

/** Short TTL for the userId→org resolution — org membership changes rarely (H8). */
const ORG_RESOLUTION_TTL_MS = 60_000;

@Injectable()
export class BillingService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly stripeService: StripeService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly telnyxService: TelnyxService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getRequiredOrg(
    userOrId: string | { id: string; organizationId?: string | null },
  ): Promise<string> {
    // Fast path: the JWT payload already carries the org — no lookup at all (H8).
    if (
      typeof userOrId === 'object' &&
      userOrId !== null &&
      userOrId.organizationId
    ) {
      return userOrId.organizationId;
    }

    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;

    // Cache the userId→org resolution so repeated getRequiredOrg(userId) calls within a request
    // (and across nearby requests) don't each re-query the users table (H8).
    const cacheKey = `orgByUser:${userId}`;
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const users = await this.db
      .select({ organizationId: schema.users.organizationId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const user = users[0];
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!user.organizationId) {
      throw new ForbiddenException(
        'User does not belong to an organization. Contact your administrator.',
      );
    }

    await this.cacheManager.set(
      cacheKey,
      user.organizationId,
      ORG_RESOLUTION_TTL_MS,
    );
    return user.organizationId;
  }

  async createCheckoutSession(userId: string, checkoutDto: CheckoutDto) {
    const organizationId = await this.getRequiredOrg(userId);

    // Look up requested plan details to find the Stripe priceId
    const plan = await this.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, checkoutDto.planId))
      .limit(1);

    const targetPlan = plan[0];
    if (!targetPlan || !targetPlan.priceId) {
      throw new BadRequestException(
        `Plan ${checkoutDto.planId} is invalid or has no associated Stripe Price.`,
      );
    }

    // Retrieve active subscription to check for existing Stripe customer ID
    const subscription = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId))
      .limit(1);

    const activeSub = subscription[0];
    const stripeCustomerId = activeSub?.stripeCustomerId;

    const user = (
      await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1)
    )[0];
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const sessionOptions: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: targetPlan.priceId,
          quantity: 1,
        },
      ],
      client_reference_id: organizationId,
      success_url: checkoutDto.successUrl,
      cancel_url: checkoutDto.cancelUrl,
    };

    if (stripeCustomerId) {
      sessionOptions.customer = stripeCustomerId;
    } else {
      sessionOptions.customer_email = user.email;
    }

    try {
      const session =
        await this.stripeService.client.checkout.sessions.create(
          sessionOptions,
        );
      return { url: session.url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown Stripe error';
      throw new BadRequestException(
        `Stripe Checkout Session generation failed: ${msg}`,
      );
    }
  }

  async createPortalSession(userId: string, returnUrl: string) {
    const organizationId = await this.getRequiredOrg(userId);

    const subscription = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId))
      .limit(1);

    const activeSub = subscription[0];
    if (!activeSub || !activeSub.stripeCustomerId) {
      throw new BadRequestException(
        'Organization does not have an active billing profile in Stripe.',
      );
    }

    try {
      const session =
        await this.stripeService.client.billingPortal.sessions.create({
          customer: activeSub.stripeCustomerId,
          return_url: returnUrl,
        });
      return { url: session.url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown Stripe error';
      throw new BadRequestException(
        `Stripe Portal Session generation failed: ${msg}`,
      );
    }
  }

  async getSubscription(userId: string) {
    const organizationId = await this.getRequiredOrg(userId);

    const subscription = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId))
      .limit(1);

    const activeSub = subscription[0];
    const planId = activeSub?.planId || 'free';

    const plan = await this.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);

    return {
      organizationId,
      subscription: activeSub || {
        planId: 'free',
        status: 'active',
        cancelAtPeriodEnd: false,
      },
      plan: plan[0] || {
        id: 'free',
        name: 'Free Plan',
        voiceAgentsLimit: 1,
        monthlyMinutesLimit: 30,
        phoneNumbersLimit: 1,
        kbSizeLimit: 10,
        websiteImportsLimit: 1,
        orderVolumeLimit: 50,
      },
    };
  }

  async getApiKey(userId: string): Promise<{ apiKey: string }> {
    const orgId = await this.getRequiredOrg(userId);

    const orgs = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);

    const org = orgs[0];
    if (!org) {
      throw new NotFoundException('Organization not found.');
    }

    if (org.webhookApiKey) {
      return { apiKey: 'sk_live_*** (Rotate to view a new key)' };
    }

    // Generate a new one if none exists
    const newKey = `sk_live_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(newKey).digest('hex');

    await this.db
      .update(schema.organizations)
      .set({ webhookApiKey: keyHash })
      .where(eq(schema.organizations.id, orgId));

    await this.syncApiKeyToAssistants(orgId, newKey);

    return { apiKey: newKey };
  }

  async rotateApiKey(userId: string): Promise<{ apiKey: string }> {
    const orgId = await this.getRequiredOrg(userId);

    const newKey = `sk_live_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(newKey).digest('hex');

    await this.db
      .update(schema.organizations)
      .set({ webhookApiKey: keyHash })
      .where(eq(schema.organizations.id, orgId));

    await this.syncApiKeyToAssistants(orgId, newKey);

    return { apiKey: newKey };
  }

  async syncApiKeyToAssistants(orgId: string, newKey: string) {
    const locs = await this.db
      .select({ telnyxAssistantId: schema.locations.telnyxAssistantId })
      .from(schema.locations)
      .where(eq(schema.locations.organizationId, orgId));

    for (const loc of locs) {
      if (loc.telnyxAssistantId) {
        await this.telnyxService.updateAssistantDynamicVariable(
          loc.telnyxAssistantId,
          { order_key: newKey },
        );
      }
    }
  }

  async getBillingOverview() {
    const subs = await this.db.select().from(schema.subscriptions);
    const usages = await this.db
      .select({
        orgId: schema.usageEvents.organizationId,
        eventType: schema.usageEvents.eventType,
        amount: sql<number>`SUM(${schema.usageEvents.amount})::int`,
      })
      .from(schema.usageEvents)
      .groupBy(schema.usageEvents.organizationId, schema.usageEvents.eventType);

    return { subscriptions: subs, usages };
  }

  async getLocationInvoicePdf(
    locationId: string,
    orgId: string,
  ): Promise<Buffer> {
    const locs = await this.db
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, locationId),
          eq(schema.locations.organizationId, orgId),
        ),
      )
      .limit(1);
    const loc = locs[0];
    if (!loc) throw new NotFoundException('Location not found.');

    const orgs = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);
    const org = orgs[0];

    const usageRes = await this.db
      .select({
        eventType: schema.usageEvents.eventType,
        totalAmount: sql<number>`SUM(${schema.usageEvents.amount})::int`,
      })
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.organizationId, orgId),
          eq(schema.usageEvents.locationId, locationId),
        ),
      )
      .groupBy(schema.usageEvents.eventType);

    const usageData = usageRes.reduce(
      (acc, row) => {
        acc[row.eventType] = row.totalAmount;
        return acc;
      },
      {} as Record<string, number>,
    );

    return this.invoicePdfService.generateInvoicePdf(
      org.name,
      loc.name,
      'Current Period',
      usageData,
    );
  }

  async getMarginReport(userId: string, locationId: string) {
    const orgId = await this.getRequiredOrg(userId);

    // Tenant isolation: the location must belong to the caller's organization.
    // Without this, any authenticated user could read usage/margin for any location UUID.
    const ownedLoc = await this.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, locationId),
          eq(schema.locations.organizationId, orgId),
        ),
      )
      .limit(1);

    if (ownedLoc.length === 0) {
      throw new NotFoundException('Location not found.');
    }

    const subscription = await this.db
      .select({
        planId: schema.subscriptions.planId,
      })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.locationId, locationId),
          eq(schema.subscriptions.organizationId, orgId),
        ),
      )
      .limit(1);

    let revenueCents = 0;
    if (subscription.length > 0 && subscription[0].planId !== 'free') {
      const plan = await this.db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, subscription[0].planId))
        .limit(1);

      if (plan[0]?.priceId) {
        try {
          const price = await this.stripeService.client.prices.retrieve(
            plan[0].priceId,
          );
          revenueCents = price.unit_amount || 0;
        } catch {
          // Fallback or ignore
        }
      }
    }

    const usageRes = await this.db
      .select({
        eventType: schema.usageEvents.eventType,
        totalAmount: sql<number>`SUM(${schema.usageEvents.amount})::int`,
      })
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.organizationId, orgId),
          eq(schema.usageEvents.locationId, locationId),
        ),
      )
      .groupBy(schema.usageEvents.eventType);

    let costCents = 0;
    const usageDetails: Record<string, number> = {};
    for (const u of usageRes) {
      usageDetails[u.eventType] = u.totalAmount;
      if (u.eventType === 'call_minutes') costCents += u.totalAmount * 5; // 5 cents/min
      if (u.eventType === 'ai_transcription') costCents += u.totalAmount * 2; // 2 cents/txn
      if (u.eventType === 'ai_summary') costCents += u.totalAmount * 1; // 1 cent/summary
      if (u.eventType === 'sms') costCents += u.totalAmount * 1; // 1 cent/sms
    }

    return {
      revenueCents,
      costCents,
      marginCents: revenueCents - costCents,
      marginPercentage:
        revenueCents > 0
          ? ((revenueCents - costCents) / revenueCents) * 100
          : 0,
      usageDetails,
    };
  }
}
