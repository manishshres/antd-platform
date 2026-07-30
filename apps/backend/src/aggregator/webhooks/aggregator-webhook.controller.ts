import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
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
import { ProviderRegistryService } from '../core/services/provider-registry.service';
import { CredentialEncryptionService } from '../core/services/credential-encryption.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import { AggregatorWebhookIngestService } from './aggregator-webhook-ingest.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Per-account inbound webhook receiver for marketplaces whose webhook URL is registered
 * per store (KitchenHub, DoorDash). The `:accountId` segment is embedded in the URL we
 * register with the provider, so it identifies the tenant without trusting the body.
 * (Uber Eats has a single Primary Webhook URL and resolves the tenant by store id — see
 * `UberEatsWebhookController`.) Flow: validate the provider's secret, reserve idempotency,
 * record a delivery audit row, enqueue, and return 202 immediately.
 */
@ApiTags('Webhooks')
@Public() // Authenticated by the provider's webhook secret, not JWT.
@Controller('webhooks/aggregator')
export class AggregatorWebhookController {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly encryption: CredentialEncryptionService,
    private readonly repo: AggregatorRepository,
    private readonly ingest: AggregatorWebhookIngestService,
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

    // Reserve idempotency + enqueue via the shared tail (same behavior as the Uber receiver).
    const { duplicate } = await this.ingest.ingest({
      provider,
      providerId: account.providerId,
      integrationAccountId: accountId,
      organizationId: account.organizationId,
      locationId: account.locationId,
      eventId,
      eventType: event.eventType,
      externalOrderId: event.externalOrderId,
      rawPayload: body,
    });

    return duplicate ? { received: true, duplicate: true } : { received: true };
  }
}
