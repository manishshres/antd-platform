import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class OutboundWebhooksDispatcherService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('outbound-webhooks-queue')
    private readonly queue: Queue,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(payload: {
    orgId: string;
    fullOrder: Record<string, unknown>;
  }) {
    await this.dispatch(payload.orgId, 'order.created', payload.fullOrder);
  }

  @OnEvent('order.updated')
  async handleOrderUpdated(payload: {
    orgId: string;
    updatedOrder: Record<string, unknown>;
  }) {
    await this.dispatch(payload.orgId, 'order.updated', payload.updatedOrder);
  }

  async dispatch(
    organizationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) {
    // Find all active endpoints for this organization that subscribe to this event
    const endpoints = await this.db
      .select()
      .from(schema.orgWebhooks)
      .where(
        and(
          eq(schema.orgWebhooks.organizationId, organizationId),
          eq(schema.orgWebhooks.isActive, true),
        ),
      );

    const targetEndpoints = endpoints.filter(
      (ep) =>
        (ep.events as string[]).includes(event) ||
        (ep.events as string[]).includes('*'),
    );

    for (const ep of targetEndpoints) {
      await this.queue.add(
        'dispatch-webhook',
        {
          url: ep.url,
          secret: ep.secret,
          event,
          payload,
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          jobId: `webhook-${ep.id}-${event}-${Date.now()}`,
        },
      );
    }
  }
}
