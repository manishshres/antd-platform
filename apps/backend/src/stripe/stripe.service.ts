import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  public readonly client: Stripe;

  constructor(private readonly configService: ConfigService) {
    let apiKey = this.configService.get<string>('STRIPE_API_KEY');

    if (!apiKey) {
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        this.logger.warn(
          'STRIPE_API_KEY is missing. Falling back to test placeholder for development.',
        );
        apiKey = 'sk_test_placeholder';
      } else {
        throw new Error(
          'STRIPE_API_KEY is missing in production environment. StripeService cannot initialize.',
        );
      }
    }

    // Let the SDK use its compiled-in API version to match types
    this.client = new Stripe(apiKey);
  }

  constructEvent(
    payload: Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event {
    return this.client.webhooks.constructEvent(payload, signature, secret);
  }
}
