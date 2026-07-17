import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../../database/database.module';
import * as schema from '../../../database/schema';
import { Public } from '../../../common/decorators/public.decorator';
import { ProviderRegistryService } from '../core/services/provider-registry.service';
import { CredentialEncryptionService } from '../core/services/credential-encryption.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import {
  AGGREGATOR_WEBHOOK_QUEUE,
  AggregatorWebhookJob,
} from '../queues/aggregator-webhook.types';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Unified inbound webhook receiver for every marketplace. The `:accountId` segment
 * is embedded in the URL we register with the provider, so it identifies the tenant
 * without trusting the body. Flow (mirrors the AI webhook path): validate the
 * provider's secret, reserve idempotency in webhook_events, record a delivery audit
 * row, enqueue, and return 202 immediately so the provider never times out.
 */
@ApiTags('Webhooks')
@Public() // Authenticated by the provider's webhook secret, not JWT.
@Controller('webhooks/aggregator')
export class AggregatorWebhookController {
  private readonly logger = new Logger(AggregatorWebhookController.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue(AGGREGATOR_WEBHOOK_QUEUE)
    private readonly queue: Queue<AggregatorWebhookJob>,
    private readonly registry: ProviderRegistryService,
    private readonly encryption: CredentialEncryptionService,
    private readonly repo: AggregatorRepository,
  ) {}

  @Post(':provider/:accountId')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive a marketplace webhook (KitchenHub, DoorDash, ...)',
    description:
      'Provider-agnostic. Validates the provider webhook secret, dedupes, and enqueues.',
  })
  @ApiResponse({ status: 202, description: 'Event accepted for processing.' })
  @ApiResponse({ status: 401, description: 'Invalid webhook secret/account.' })
  async handle(
    @Param('provider') provider: string,
    @Param('accountId') accountId: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
    @Req() req: RequestWithRawBody,
  ) {
    if (!this.registry.has(provider)) {
      throw new NotFoundException(`Unknown provider: ${provider}`);
    }
    const webhookProvider = this.registry.getWebhookProvider(provider);

    // Resolve the tenant from the URL-embedded account id, and confirm it belongs to
    // this provider (defends against a valid account id under the wrong provider path).
    const account = await this.repo.findIntegrationAccountById(accountId);
    const providerRow = await this.repo.findProviderByName(provider);
    if (!account || !providerRow || account.providerId !== providerRow.id) {
      throw new UnauthorizedException('Unknown integration account.');
    }

    const creds = account.credentials
      ? this.encryption.decryptJson<Record<string, unknown>>(
          account.credentials as string,
        )
      : {};

    // HMAC providers (Uber Eats) need the exact received bytes; fall back to a
    // re-serialized body only if the raw buffer wasn't captured.
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));
    if (!webhookProvider.validateWebhook(rawBody, headers, creds)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    const event = webhookProvider.parseEvent(body);
    const eventId = `${provider}:${event.externalEventId || randomUUID()}`;

    // Primary idempotency guard — atomic reservation on the webhook_events PK.
    const inserted = await this.db
      .insert(schema.webhookEvents)
      .values({
        eventId,
        provider,
        status: 'pending',
        eventType: event.eventType,
        payload: body,
        receivedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      await this.repo.recordWebhookDelivery({
        webhookEventId: eventId,
        responseCode: HttpStatus.ACCEPTED,
        errorMessage: 'duplicate',
        processedAt: new Date(),
      });
      return { received: true, duplicate: true };
    }

    await this.repo.recordWebhookDelivery({
      webhookEventId: eventId,
      responseCode: HttpStatus.ACCEPTED,
    });

    try {
      await this.queue.add('aggregator-webhook', {
        provider,
        providerId: account.providerId,
        integrationAccountId: accountId,
        organizationId: account.organizationId,
        locationId: account.locationId,
        eventType: event.eventType,
        externalOrderId: event.externalOrderId,
        webhookEventId: eventId,
        rawPayload: body,
      });
    } catch (err) {
      // Release the reservation so a provider retry isn't swallowed as a duplicate.
      await this.db
        .delete(schema.webhookEvents)
        .where(eq(schema.webhookEvents.eventId, eventId));
      this.logger.error(
        `Failed to enqueue ${provider} webhook for account ${accountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    return { received: true };
  }
}
