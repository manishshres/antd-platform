import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import * as schema from '../../database/schema';
import { OrdersService } from '../../orders/orders.service';
import { ProviderRegistryService } from '../core/services/provider-registry.service';
import { OrderNormalizationService } from '../core/services/order-normalization.service';
import {
  ConeekOrderStatus,
  OrderStatusTransitionService,
} from '../core/services/order-status-transition.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import {
  AGGREGATOR_WEBHOOK_QUEUE,
  AggregatorWebhookJob,
} from './aggregator-webhook.types';

/**
 * Consumes normalized marketplace webhook jobs. Order-created events import a native
 * Coneeko order (raw → external_orders → orders) and auto-accept on the marketplace so
 * the customer is confirmed; order status/cancel events map the marketplace status into
 * a validated Coneeko transition. Idempotency is guaranteed upstream (webhook_events)
 * and inside the import (external_orders + clientOrderId), so retries are safe.
 */
@Processor(AGGREGATOR_WEBHOOK_QUEUE)
export class AggregatorWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(AggregatorWebhookProcessor.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly registry: ProviderRegistryService,
    private readonly normalization: OrderNormalizationService,
    private readonly statusTransition: OrderStatusTransitionService,
    private readonly ordersService: OrdersService,
    private readonly repo: AggregatorRepository,
  ) {
    super();
  }

  async process(job: Job<AggregatorWebhookJob>): Promise<unknown> {
    const data = job.data;
    this.logger.log(
      `Processing ${data.provider} webhook ${data.eventType} (event ${data.webhookEventId})`,
    );

    let result: unknown = { handled: false };
    try {
      switch (data.eventType) {
        case 'order.created':
          result = await this.handleOrderCreated(data);
          break;
        case 'order.updated':
        case 'order.canceled':
          result = await this.handleStatusChange(data);
          break;
        default:
          // delivery.status / menu.sync.status / unknown — recorded, not yet acted on.
          this.logger.log(
            `No handler for ${data.provider} event ${data.eventType}; acknowledged.`,
          );
      }

      await this.markCompleted(data.webhookEventId);
      return result;
    } catch (err) {
      await this.markFailed(data.webhookEventId);
      throw err; // let BullMQ retry with backoff
    }
  }

  private async handleOrderCreated(data: AggregatorWebhookJob) {
    // Providers that embed the order in the webhook (KitchenHub) map it directly;
    // notification-only providers (Uber Eats) return null here, so we fetch the full
    // order from the API using the id carried in the event.
    let normalized = this.registry
      .getOrderExtractor(data.provider)
      .orderFromWebhook(data.rawPayload);
    if (!normalized && data.externalOrderId) {
      normalized = await this.registry
        .getOrderProvider(data.provider)
        .getOrder(data.integrationAccountId, data.externalOrderId);
    }
    if (!normalized) {
      this.logger.warn(
        `${data.provider} order.created carried no resolvable order; skipping.`,
      );
      return { imported: false };
    }

    const importResult = await this.normalization.importOrder(normalized, {
      providerId: data.providerId,
      providerName: data.provider,
      integrationAccountId: data.integrationAccountId,
      organizationId: data.organizationId,
      locationId: data.locationId,
    });

    // Auto-accept on the marketplace (prepaid orders are confirmed to the customer).
    // A failure here doesn't undo the import — log and let it be retried/accepted manually.
    try {
      await this.registry
        .getOrderProvider(data.provider)
        .acceptOrder(data.integrationAccountId, normalized.externalOrderId);
    } catch (err) {
      this.logger.warn(
        `Imported ${data.provider} order ${normalized.externalOrderId} but auto-accept failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return importResult;
  }

  private async handleStatusChange(data: AggregatorWebhookJob) {
    const externalOrderId = data.externalOrderId;
    if (!externalOrderId) {
      this.logger.warn(
        `${data.provider} ${data.eventType} had no externalOrderId; skipping.`,
      );
      return { updated: false };
    }

    const external = await this.repo.findExternalOrderByProviderExternalId(
      data.providerId,
      externalOrderId,
    );
    if (!external?.internalOrderId) {
      this.logger.warn(
        `${data.provider} status event for ${externalOrderId} has no imported order yet; skipping.`,
      );
      return { updated: false };
    }

    const [order] = await this.db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, external.internalOrderId))
      .limit(1);
    if (!order) return { updated: false };

    const target: ConeekOrderStatus =
      data.eventType === 'order.canceled'
        ? 'cancelled'
        : this.targetStatus(data);

    const current = order.status as ConeekOrderStatus;
    if (current === target) return { updated: false, status: current };
    if (!this.statusTransition.canTransition(current, target)) {
      this.logger.warn(
        `Ignoring illegal ${data.provider} transition ${current} → ${target} for order ${external.internalOrderId}.`,
      );
      return { updated: false, status: current };
    }

    await this.ordersService.updateStatusForAggregator(
      data.organizationId,
      external.internalOrderId,
      target,
    );
    return { updated: true, status: target };
  }

  private targetStatus(data: AggregatorWebhookJob): ConeekOrderStatus {
    const normalized = this.registry
      .getOrderExtractor(data.provider)
      .orderFromWebhook(data.rawPayload);
    return this.statusTransition.mapExternalStatus(
      normalized?.externalStatus ?? 'new',
    );
  }

  private async markCompleted(webhookEventId: string) {
    await this.db
      .update(schema.webhookEvents)
      .set({ status: 'completed', processedAt: new Date() })
      .where(eq(schema.webhookEvents.eventId, webhookEventId));
  }

  private async markFailed(webhookEventId: string) {
    await this.db
      .update(schema.webhookEvents)
      .set({ status: 'failed' })
      .where(eq(schema.webhookEvents.eventId, webhookEventId));
  }
}
