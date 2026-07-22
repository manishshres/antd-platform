import { NormalizedWebhookEvent } from '../core/interfaces/provider-adapter.interface';

export const AGGREGATOR_WEBHOOK_QUEUE = 'aggregator-webhook-queue';

export interface AggregatorWebhookJob {
  provider: string;
  providerId: string;
  integrationAccountId: string;
  organizationId: string;
  locationId: string | null;
  eventType: NormalizedWebhookEvent['eventType'];
  externalOrderId?: string;
  /** webhook_events.eventId reserved at ingestion (also used to mark completion). */
  webhookEventId: string;
  rawPayload: unknown;
}
