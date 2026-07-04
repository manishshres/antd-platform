import {
  Controller,
  Post,
  Headers,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@ApiTags('Stripe Webhook')
@Controller('stripe')
export class StripeWebhookController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly webhookService: StripeWebhookService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle incoming Stripe webhooks' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid signature or payload' })
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RequestWithRawBody,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header.');
    }

    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      throw new BadRequestException('Webhook secret is not configured.');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Raw request body is missing. Ensure rawBody is enabled.',
      );
    }

    try {
      const event = this.stripeService.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
      await this.webhookService.handleEvent(event);
      return { received: true };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(
        `Webhook signature verification failed: ${errorMessage}`,
      );
    }
  }
}
