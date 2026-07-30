import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import * as schema from '../../database/schema';
import { AggregatorRepository } from '../database/aggregator.repository';
import {
  AGGREGATOR_WEBHOOK_QUEUE,
  AggregatorWebhookJob,
} from '../queues/aggregator-webhook.types';

export interface WebhookIngestInput {
  provider: string;
  providerId: string;
  integrationAccountId: string;
  organizationId: string;
  locationId: string | null;
  /** Stable per-event id used for idempotency (already provider-namespaced). */
  eventId: string;
  eventType: AggregatorWebhookJob['eventType'];
  externalOrderId?: string;
  resourceHref?: string;
  rawPayload: Record<string, unknown>;
}

/**
 * Shared ingestion tail for every marketplace webhook receiver: reserve idempotency on
 * `webhook_events`, record a delivery audit row, and enqueue the processing job (releasing
 * the reservation if the enqueue fails so a provider retry isn't swallowed as a duplicate).
 * Both the generic per-account receiver and the Uber single-URL receiver call this so the
 * dedupe/enqueue behavior can never drift between them.
 */
@Injectable()
export class AggregatorWebhookIngestService {
  private readonly logger = new Logger(AggregatorWebhookIngestService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue(AGGREGATOR_WEBHOOK_QUEUE)
    private readonly queue: Queue<AggregatorWebhookJob>,
    private readonly repo: AggregatorRepository,
  ) {}

  /** Returns whether the event was newly accepted (false = duplicate, already seen). */
  async ingest(input: WebhookIngestInput): Promise<{ duplicate: boolean }> {
    const inserted = await this.db
      .insert(schema.webhookEvents)
      .values({
        eventId: input.eventId,
        provider: input.provider,
        status: 'pending',
        eventType: input.eventType,
        payload: input.rawPayload,
        receivedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      await this.repo.recordWebhookDelivery({
        webhookEventId: input.eventId,
        responseCode: HttpStatus.ACCEPTED,
        errorMessage: 'duplicate',
        processedAt: new Date(),
      });
      return { duplicate: true };
    }

    await this.repo.recordWebhookDelivery({
      webhookEventId: input.eventId,
      responseCode: HttpStatus.ACCEPTED,
    });

    try {
      await this.queue.add('aggregator-webhook', {
        provider: input.provider,
        providerId: input.providerId,
        integrationAccountId: input.integrationAccountId,
        organizationId: input.organizationId,
        locationId: input.locationId,
        eventType: input.eventType,
        externalOrderId: input.externalOrderId,
        resourceHref: input.resourceHref,
        webhookEventId: input.eventId,
        rawPayload: input.rawPayload,
      });
    } catch (err) {
      // Release the reservation so a provider retry isn't dropped as a duplicate.
      await this.db
        .delete(schema.webhookEvents)
        .where(eq(schema.webhookEvents.eventId, input.eventId));
      this.logger.error(
        `Failed to enqueue ${input.provider} webhook (event ${input.eventId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    return { duplicate: false };
  }
}
