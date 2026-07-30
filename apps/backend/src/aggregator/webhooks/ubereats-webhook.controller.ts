import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { CredentialEncryptionService } from '../core/services/credential-encryption.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import { UberEatsAdapter } from '../providers/ubereats/ubereats.adapter';
import {
  webhookStoreId,
  webhookOrderId,
} from '../providers/ubereats/ubereats.mapper';
import type { UberEatsWebhookBody } from '../providers/ubereats/ubereats.types';
import { AggregatorWebhookIngestService } from './aggregator-webhook-ingest.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const UBEREATS_PROVIDER = 'ubereats';

/**
 * Uber Eats Primary Webhook URL. Unlike KitchenHub (a per-store URL with the account id in
 * the path), Uber sends **every** store's events to one URL configured in its dashboard, so
 * the tenant is resolved from the store id in the body (`meta.user_id`, docs: "corresponds
 * to store_id"). We then verify the HMAC with that store's client secret, dedupe, enqueue,
 * and return an **empty 200** — Uber's required acknowledgement (it retries otherwise).
 *
 * Register this URL in the Uber developer dashboard: POST {BASE}/webhooks/aggregator/ubereats
 */
@ApiTags('Webhooks')
@Public() // Authenticated by Uber's HMAC signature, not JWT.
@Controller('webhooks/aggregator/ubereats')
export class UberEatsWebhookController {
  private readonly logger = new Logger(UberEatsWebhookController.name);

  constructor(
    private readonly adapter: UberEatsAdapter,
    private readonly encryption: CredentialEncryptionService,
    private readonly repo: AggregatorRepository,
    private readonly ingest: AggregatorWebhookIngestService,
  ) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Uber Eats Primary Webhook URL (all stores, all event types)',
    description:
      'Resolves the tenant from the store id in the body, verifies the X-Uber-Signature ' +
      'HMAC, dedupes, and enqueues. Returns an empty 200 to acknowledge.',
  })
  @ApiResponse({ status: 200, description: 'Event accepted.' })
  @ApiResponse({
    status: 401,
    description: 'Unknown store or invalid signature.',
  })
  async handle(
    @Body() body: UberEatsWebhookBody,
    @Headers() headers: Record<string, string>,
    @Req() req: RequestWithRawBody,
  ): Promise<void> {
    const storeId = webhookStoreId(body);
    if (!storeId) {
      // No store id → can't attribute the event to a tenant. Ack anyway (an empty 200)
      // so Uber doesn't retry an event we can never route; log for investigation.
      this.logger.warn(
        `Uber webhook ${body.event_type ?? 'unknown'} carried no store id; ignoring.`,
      );
      return;
    }

    const providerRow = await this.repo.findProviderByName(UBEREATS_PROVIDER);
    if (!providerRow) {
      this.logger.error('ubereats provider row missing; is the DB seeded?');
      throw new UnauthorizedException('Provider not configured.');
    }

    const account = await this.repo.findIntegrationAccountByProviderStoreId(
      providerRow.id,
      storeId,
    );
    if (!account) {
      throw new UnauthorizedException(
        `No integration account for Uber store ${storeId}.`,
      );
    }

    const creds = account.credentials
      ? this.encryption.decryptJson<Record<string, unknown>>(
          account.credentials as string,
        )
      : {};

    // HMAC is computed over the exact received bytes — re-serializing would change it.
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));
    if (!this.adapter.validateWebhook(rawBody, headers, creds)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    const event = this.adapter.parseEvent(body);
    const eventId = `${UBEREATS_PROVIDER}:${event.externalEventId || randomUUID()}`;

    const { duplicate } = await this.ingest.ingest({
      provider: UBEREATS_PROVIDER,
      providerId: account.providerId,
      integrationAccountId: account.id,
      organizationId: account.organizationId,
      locationId: account.locationId,
      eventId,
      eventType: event.eventType,
      externalOrderId: event.externalOrderId ?? webhookOrderId(body),
      resourceHref: body.resource_href,
      rawPayload: body as unknown as Record<string, unknown>,
    });

    if (duplicate) {
      this.logger.debug(`Duplicate Uber webhook ${eventId}; acknowledged.`);
    }
    // Empty 200 — Uber's required acknowledgement (@HttpCode(200) + void return).
  }
}
