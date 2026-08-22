import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHmac } from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Redis } from 'ioredis';
import { SHARED_WORKER_OPTIONS } from '../../queues/queues.module';

interface OutboundWebhookJobData {
  url: string;
  secret: string;
  event: string;
  payload: Record<string, unknown>;
}

@Processor('outbound-webhooks-queue', SHARED_WORKER_OPTIONS)
export class OutboundWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundWebhookProcessor.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {
    super();
  }

  async process(
    job: Job<OutboundWebhookJobData, unknown, string>,
  ): Promise<void> {
    const { url, secret, event, payload } = job.data;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const store = (this.cacheManager as any).store as { client?: Redis };
    const client = store.client;
    const idempKey = `idempotency:outbound:${job.id}`;

    if (client && typeof client.get === 'function') {
      const alreadySent = await client.get(idempKey);
      if (alreadySent) {
        this.logger.warn(
          `Outbound webhook for job ${job.id} was already dispatched. Skipping.`,
        );
        return;
      }
    }

    this.logger.log(`Dispatching ${event} to ${url}`);

    // Generate HMAC signature for security
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signaturePayload = `${timestamp}.${JSON.stringify(payload)}`;
    const signature = createHmac('sha256', secret)
      .update(signaturePayload)
      .digest('hex');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `t=${timestamp},v1=${signature}`,
          'X-Webhook-Event': event,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Endpoint returned status ${response.status}: ${response.statusText}`,
        );
      }

      if (client && typeof client.set === 'function') {
        await client.set(idempKey, '1', 'EX', 86400 * 7); // keep for 7 days
      }

      this.logger.log(`Successfully dispatched ${event} to ${url}`);
    } catch (error) {
      this.logger.error(
        `Failed to dispatch ${event} to ${url}: ${(error as Error).message}`,
      );
      throw error; // Let BullMQ retry
    }
  }
}
