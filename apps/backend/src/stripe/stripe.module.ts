import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  controllers: [StripeWebhookController],
  providers: [StripeService, StripeWebhookService],
  exports: [StripeService],
})
export class StripeModule {}
