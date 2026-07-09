import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Logger,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Job } from 'bullmq';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq, and, ilike } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

interface WebhookJobData {
  orgId: string;
  idempotencyKey?: string;
  customerName: string;
  customerPhone: string;
  items: {
    menuItemId?: string;
    name?: string;
    quantity: number;
    modifiers?: string[];
  }[];
  orderType?: string;
  specialInstructions?: string;
}

@Processor('webhook-queue')
export class WebhookQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookQueueProcessor.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData, any, string>): Promise<any> {
    const {
      orgId,
      customerName,
      customerPhone,
      items,
      orderType,
      specialInstructions,
      idempotencyKey,
    } = job.data;

    if (idempotencyKey) {
      const idempKey = `idempotency:inbound:${idempotencyKey}`;
      // Secondary dedup guarding against a BullMQ retry re-creating an order that a prior attempt
      // already created. This layers on top of the DB-level webhook_events reservation (the
      // primary, atomic idempotency guard at ingestion). cache-manager v7 is Keyv-based and
      // exposes no raw Redis client, so use its standard async API — and fail open on any cache
      // error so a cache hiccup can never drop a legitimate order.
      try {
        const alreadySeen = await this.cacheManager.get(idempKey);
        if (alreadySeen) {
          this.logger.warn(
            `Idempotency key ${idempotencyKey} already processed. Skipping duplicate AI order.`,
          );
          return { message: 'Skipped duplicate webhook' };
        }
        // 24 hour TTL (cache-manager v7 expects milliseconds).
        await this.cacheManager.set(idempKey, '1', 86400 * 1000);
      } catch (err) {
        this.logger.warn(
          `Idempotency cache unavailable for key ${idempotencyKey}; proceeding on the DB reservation guard: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(
      `Processing background AI order for org ${orgId}, customer: ${customerName}`,
    );

    if (!items || items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    const resolvedItems: {
      menuItemId: string;
      quantity: number;
      modifiers?: string[];
    }[] = [];

    for (const item of items) {
      let menuItemId = item.menuItemId;

      if (!menuItemId && item.name) {
        // Resolve by name (case-insensitive) under organization
        const dbItems = await this.db
          .select({ id: schema.menuItems.id })
          .from(schema.menuItems)
          .innerJoin(
            schema.categories,
            eq(schema.menuItems.categoryId, schema.categories.id),
          )
          .where(
            and(
              eq(schema.categories.organizationId, orgId),
              ilike(schema.menuItems.name, item.name),
            ),
          )
          .limit(1);

        const foundItem = dbItems[0];
        if (!foundItem) {
          throw new NotFoundException(
            `Menu item with name "${item.name}" not found.`,
          );
        }
        menuItemId = foundItem.id;
      }

      if (!menuItemId) {
        throw new BadRequestException(
          'Each item must have either menuItemId or name.',
        );
      }

      resolvedItems.push({
        menuItemId,
        quantity: item.quantity,
        modifiers: item.modifiers,
      });
    }

    // Emit the order to be created (this also triggers printer queue enqueuing in OrdersService listener)
    const [order] = await this.eventEmitter.emitAsync('order.incoming', {
      orgId,
      customerName,
      customerPhone,
      items: resolvedItems,
      orderType,
      specialInstructions,
    });

    this.logger.log(
      `Background order processing complete. Order ID: ${order.id}`,
    );

    // Mark the webhook event as completed so the reservation moves from 'pending' to 'completed'.
    if (idempotencyKey) {
      await this.db
        .update(schema.webhookEvents)
        .set({ status: 'completed', processedAt: new Date() })
        .where(eq(schema.webhookEvents.eventId, idempotencyKey));
    }

    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
    };
  }
}
