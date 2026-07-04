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

import { Redis } from 'ioredis';

interface WebhookJobData {
  orgId: string;
  idempotencyKey?: string;
  customerName: string;
  customerPhone: string;
  items: {
    menuItemId?: string;
    name?: string;
    quantity: number;
  }[];
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
    const { orgId, customerName, customerPhone, items, idempotencyKey } =
      job.data;

    if (idempotencyKey) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const store = (this.cacheManager as any).store as { client?: Redis };
      const client = store.client;
      if (client && typeof client.set === 'function') {
        const idempKey = `idempotency:inbound:${idempotencyKey}`;
        // Set if Not eXists with a 24 hour expiry (86400 seconds)
        const setnxResult = await client.set(idempKey, '1', 'EX', 86400, 'NX');
        if (!setnxResult) {
          this.logger.warn(
            `Idempotency key ${idempotencyKey} already processed. Skipping duplicate AI order.`,
          );
          return { message: 'Skipped duplicate webhook' };
        }
      }
    }

    this.logger.log(
      `Processing background AI order for org ${orgId}, customer: ${customerName}`,
    );

    if (!items || items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    const resolvedItems: { menuItemId: string; quantity: number }[] = [];

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
      });
    }

    // Emit the order to be created (this also triggers printer queue enqueuing in OrdersService listener)
    const [order] = await this.eventEmitter.emitAsync('order.incoming', {
      orgId,
      customerName,
      customerPhone,
      items: resolvedItems,
    });

    this.logger.log(
      `Background order processing complete. Order ID: ${order.id}`,
    );
    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
    };
  }
}
