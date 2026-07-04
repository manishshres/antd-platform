import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly stripeService: StripeService,
  ) {}

  async handleEvent(event: Stripe.Event) {
    this.logger.log(
      `Handling Stripe event type: ${event.type} (id: ${event.id})`,
    );

    // Idempotency check
    const inserted = await this.db
      .insert(schema.webhookEvents)
      .values({
        eventId: event.id,
        provider: 'stripe',
        status: 'processing',
        receivedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      this.logger.warn(`Duplicate webhook event ignored: ${event.id}`);
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          await this.handleCheckoutSessionCompleted(session);
          break;
        }
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          await this.handleSubscriptionUpdated(subscription);
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          await this.handleSubscriptionDeleted(subscription);
          break;
        }
        default:
          this.logger.debug(`Unhandled event type: ${event.type}`);
      }

      await this.db
        .update(schema.webhookEvents)
        .set({ status: 'completed', processedAt: new Date() })
        .where(eq(schema.webhookEvents.eventId, event.id));
    } catch (err) {
      this.logger.error(
        `Failed to process event ${event.id}:`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.db
        .update(schema.webhookEvents)
        .set({ status: 'failed', processedAt: new Date() })
        .where(eq(schema.webhookEvents.eventId, event.id));
      throw err;
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ) {
    const organizationId = session.client_reference_id;
    const stripeSubscriptionId = session.subscription as string;
    const stripeCustomerId = session.customer as string;

    if (!organizationId) {
      this.logger.error(
        'No client_reference_id (organizationId) in checkout session.',
      );
      return;
    }

    if (!stripeSubscriptionId) {
      this.logger.error('No subscription ID in checkout session.');
      return;
    }

    this.logger.log(
      `Processing checkout.session.completed for Organization: ${organizationId}`,
    );

    // Retrieve full subscription details from Stripe
    const subscription =
      await this.stripeService.client.subscriptions.retrieve(
        stripeSubscriptionId,
      );
    const priceId = subscription.items.data[0]?.price.id;
    const planId = await this.getPlanIdFromPriceId(priceId);

    // Prepare date — current_period_end is a Unix timestamp (seconds)
    const subLike = subscription as unknown as { current_period_end: number };
    const currentPeriodEnd = new Date(subLike.current_period_end * 1000);

    // Check if subscription already exists for organization
    const existing = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organizationId, organizationId))
      .limit(1);

    if (existing[0]) {
      // Update existing subscription
      await this.db
        .update(schema.subscriptions)
        .set({
          planId,
          stripeSubscriptionId,
          stripeCustomerId,
          status: subscription.status,
          currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptions.organizationId, organizationId));
    } else {
      // Create new subscription
      await this.db.insert(schema.subscriptions).values({
        organizationId,
        planId,
        stripeSubscriptionId,
        stripeCustomerId,
        status: subscription.status,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });
    }

    this.logger.log(
      `Subscription successfully created/updated for Org: ${organizationId}`,
    );
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const stripeSubscriptionId = subscription.id;
    const stripeCustomerId = subscription.customer as string;
    const status = subscription.status;
    const subLike = subscription as unknown as { current_period_end: number };
    const currentPeriodEnd = new Date(subLike.current_period_end * 1000);
    const cancelAtPeriodEnd = subscription.cancel_at_period_end;
    const priceId = subscription.items.data[0]?.price.id;
    const planId = await this.getPlanIdFromPriceId(priceId);

    this.logger.log(
      `Processing customer.subscription.updated for sub: ${stripeSubscriptionId}`,
    );

    // Search by Stripe Subscription ID
    const existingBySub = await this.db
      .select()
      .from(schema.subscriptions)
      .where(
        eq(schema.subscriptions.stripeSubscriptionId, stripeSubscriptionId),
      )
      .limit(1);

    if (existingBySub[0]) {
      await this.db
        .update(schema.subscriptions)
        .set({
          planId,
          status,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          updatedAt: new Date(),
        })
        .where(
          eq(schema.subscriptions.stripeSubscriptionId, stripeSubscriptionId),
        );
      this.logger.log(
        `Updated subscription ${stripeSubscriptionId} in database.`,
      );
    } else {
      // Fallback search by Customer ID
      const existingByCust = await this.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.stripeCustomerId, stripeCustomerId))
        .limit(1);

      if (existingByCust[0]) {
        await this.db
          .update(schema.subscriptions)
          .set({
            planId,
            stripeSubscriptionId,
            status,
            currentPeriodEnd,
            cancelAtPeriodEnd,
            updatedAt: new Date(),
          })
          .where(eq(schema.subscriptions.stripeCustomerId, stripeCustomerId));
        this.logger.log(
          `Updated subscription via fallback Customer ID: ${stripeCustomerId}.`,
        );
      } else {
        this.logger.warn(
          `Subscription ${stripeSubscriptionId} updated but no matching record found in DB.`,
        );
      }
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const stripeSubscriptionId = subscription.id;
    this.logger.log(
      `Processing customer.subscription.deleted for sub: ${stripeSubscriptionId}`,
    );

    // Update status to 'canceled'
    await this.db
      .update(schema.subscriptions)
      .set({
        status: 'canceled',
        planId: 'free', // Downgrade back to free tier
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(
        eq(schema.subscriptions.stripeSubscriptionId, stripeSubscriptionId),
      );
  }

  private async getPlanIdFromPriceId(
    priceId: string | undefined,
  ): Promise<string> {
    if (!priceId) return 'free';

    // Query plans table for matching priceId
    const found = await this.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.priceId, priceId))
      .limit(1);

    if (found[0]) {
      return found[0].id;
    }

    // Fallback constants if not found in db yet
    const fallbackMap: Record<string, string> = {
      price_growth_placeholder: 'growth',
      price_enterprise_placeholder: 'enterprise',
    };

    return fallbackMap[priceId] || 'free';
  }
}
