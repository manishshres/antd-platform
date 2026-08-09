import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Logger,
  Inject,
} from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq, and, ilike } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

/** What the processor hands back to BullMQ: either the created order, or a skip notice. */
export interface WebhookJobResult {
  orderId?: string;
  status?: string;
  totalAmount?: number;
  message?: string;
}

export interface WebhookJobData {
  orgId: string;
  locationId?: string;
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

  async process(
    job: Job<WebhookJobData, WebhookJobResult, string>,
  ): Promise<WebhookJobResult> {
    const {
      orgId,
      locationId,
      customerName,
      customerPhone,
      items,
      orderType,
      specialInstructions,
      idempotencyKey,
    } = job.data;

    if (idempotencyKey) {
      const idempKey = `idempotency:inbound:${idempotencyKey}`;
      try {
        const alreadySeen = await this.cacheManager.get(idempKey);
        if (alreadySeen) {
          this.logger.warn(
            `Idempotency key ${idempotencyKey} already processed. Skipping duplicate AI order.`,
          );
          return { message: 'Skipped duplicate webhook' };
        }
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
      throw new UnrecoverableError('Order must contain at least one item.');
    }

    const resolvedItems: {
      menuItemId: string;
      quantity: number;
      modifiers?: string[];
    }[] = [];

    for (const item of items) {
      let menuItemId = item.menuItemId;

      if (!menuItemId && item.name) {
        // Resolve by name (case-insensitive) under organization (and location if provided)
        const catConditions = [eq(schema.categories.organizationId, orgId)];
        if (locationId) {
          catConditions.push(eq(schema.categories.locationId, locationId));
        }

        let dbItems = await this.db
          .select({ id: schema.menuItems.id })
          .from(schema.menuItems)
          .innerJoin(
            schema.categories,
            eq(schema.menuItems.categoryId, schema.categories.id),
          )
          .where(
            and(
              ...catConditions,
              ilike(schema.menuItems.name, item.name),
            ),
          )
          .limit(1);

        // Fallback: prefix match to handle names with trailing tags like "(Spicy)" or "(Vegan)"
        if (dbItems.length === 0) {
          dbItems = await this.db
            .select({ id: schema.menuItems.id })
            .from(schema.menuItems)
            .innerJoin(
              schema.categories,
              eq(schema.menuItems.categoryId, schema.categories.id),
            )
            .where(
              and(
                ...catConditions,
                ilike(schema.menuItems.name, `${item.name}%`),
              ),
            )
            .limit(1);
        }

        const foundItem = dbItems[0];
        if (!foundItem) {
          throw new UnrecoverableError(
            `Menu item with name "${item.name}" not found.`,
          );
        }
        menuItemId = foundItem.id;
      }

      if (!menuItemId) {
        throw new UnrecoverableError(
          'Each item must have either menuItemId or name.',
        );
      }

      resolvedItems.push({
        menuItemId,
        quantity: item.quantity,
        modifiers: item.modifiers,
      });
    }

    // Emit the order to be created (this also triggers printer queue enqueuing
    // in OrdersService's listener). `emitAsync` returns a Promise<unknown[]> —
    // the listener returns the new order, which we read out here.
    const emitted = await this.eventEmitter.emitAsync('order.incoming', {
      orgId,
      customerName,
      customerPhone,
      items: resolvedItems,
      orderType,
      specialInstructions,
    });
    // Narrow the emitted payload to the order shape used downstream. The
    // listener contract is "return Order from `order.incoming`" (see
    // OrdersService.handleOrderIncomingEvent).
    const order =
      Array.isArray(emitted) && emitted[0]
        ? (emitted[0] as { id: string; status: string; totalAmount: number })
        : null;
    if (!order) {
      throw new Error('order.incoming returned no order.');
    }

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
