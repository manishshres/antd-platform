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
  /**
   * Notification-only providers (Uber Eats) send the canonical GET URL for the order in
   * the webhook. It encodes the store's pinned API version, so fetching it verbatim is
   * more robust than rebuilding a path from the id. Absent for providers that embed the
   * order in the webhook.
   */
  resourceHref?: string;
  /** webhook_events.eventId reserved at ingestion (also used to mark completion). */
  webhookEventId: string;
  rawPayload: unknown;
}
