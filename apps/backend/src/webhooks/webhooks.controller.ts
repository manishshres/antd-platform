import {
  Controller,
  Post,
  Headers,
  Body,
  Req,
  UnauthorizedException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';
import { AiOrderWebhookDto } from './dto/ai-order-webhook.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { verifyTelnyxSignature } from './telnyx-signature';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@ApiTags('Webhooks')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('webhook-queue')
    private readonly webhookQueue: Queue,
    @InjectQueue('recordings-queue')
    private readonly recordingsQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  @Post('ai/order')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest an order from the Voice AI agent',
    description:
      'Secured via X-API-Key header. Processes order asynchronously.',
  })
  @ApiResponse({ status: 202, description: 'Order accepted for processing.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Invalid API Key.' })
  async handleAiOrder(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: AiOrderWebhookDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    if (!apiKey) {
      throw new UnauthorizedException('X-API-Key header is missing.');
    }

    const hashedApiKey = createHash('sha256').update(apiKey).digest('hex');

    // Find organization matching the API key
    const orgs = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.webhookApiKey, hashedApiKey))
      .limit(1);

    const org = orgs[0];
    if (!org) {
      throw new UnauthorizedException('Invalid Webhook API Key.');
    }

    if (dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    if (idempotencyKey) {
      const inserted = await this.db
        .insert(schema.webhookEvents)
        .values({
          eventId: idempotencyKey,
          provider: 'ai_order',
          status: 'completed',
          receivedAt: new Date(),
          processedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length === 0) {
        return { message: 'Duplicate order ignored.', jobId: null };
      }
    }

    // Add to BullMQ webhook queue to process asynchronously
    const job = await this.webhookQueue.add('process-ai-order', {
      orgId: org.id,
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      items: dto.items,
      idempotencyKey,
    });

    return {
      message: 'Order received and accepted for processing.',
      jobId: job.id,
    };
  }

  @Post('telnyx')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive webhook events from Telnyx',
    description:
      'Verified via Ed25519 signature (telnyx-signature-ed25519 / telnyx-timestamp headers).',
  })
  @ApiResponse({ status: 200, description: 'Event accepted.' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature.' })
  async handleTelnyxWebhook(
    @Req() req: RequestWithRawBody,
    @Headers('telnyx-signature-ed25519') signature: string | undefined,
    @Headers('telnyx-timestamp') timestamp: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    // ── Signature verification (C1) ─────────────────────────────────────────
    const publicKey = this.configService.get<string>('TELNYX_PUBLIC_KEY');
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    if (publicKey) {
      const valid = verifyTelnyxSignature({
        publicKeyBase64: publicKey,
        signatureBase64: signature,
        timestamp,
        rawBody: req.rawBody ?? Buffer.from(JSON.stringify(body)),
      });
      if (!valid) {
        throw new UnauthorizedException('Invalid Telnyx webhook signature.');
      }
    } else if (isProd) {
      // Fail closed in production if the verification key is not configured.
      this.logger.error(
        'TELNYX_PUBLIC_KEY is not configured; rejecting Telnyx webhook in production.',
      );
      throw new UnauthorizedException(
        'Webhook verification is not configured.',
      );
    } else {
      this.logger.warn(
        'TELNYX_PUBLIC_KEY not set — skipping Telnyx signature verification (non-production).',
      );
    }

    const data = body?.data as Record<string, unknown> | undefined;
    const eventType = data?.event_type as string | undefined;
    const eventId = data?.id as string | undefined;
    const payload = data?.payload as Record<string, unknown> | undefined;

    // Require an event ID so every event is idempotency-tracked (C1).
    if (!eventId) {
      throw new BadRequestException('Telnyx event is missing an id.');
    }

    const inserted = await this.db
      .insert(schema.webhookEvents)
      .values({
        eventId,
        provider: 'telnyx',
        status: 'completed',
        receivedAt: new Date(),
        processedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      return { received: true, ignored: true };
    }

    if (eventType === 'call.recording.saved' && payload) {
      const callSessionId = payload.call_session_id as string | undefined;
      const recordingId = payload.recording_id as string | undefined;
      // Pass the dialed number so the processor can resolve the owning tenant (C2).
      const toNumber =
        (payload.to as string | undefined) ??
        (payload.destination as string | undefined);

      if (callSessionId && recordingId) {
        await this.recordingsQueue.add('import-recording', {
          callSessionId,
          recordingId,
          toNumber,
          // orgId/locationId resolved from toNumber in RecordingsProcessor.
        });
      }
    }

    return { received: true };
  }
}
