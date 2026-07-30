import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AggregatorController } from './aggregator.controller';
import { AggregatorService } from './aggregator.service';
import { AggregatorRepository } from './database/aggregator.repository';
import { CredentialEncryptionService } from './core/services/credential-encryption.service';
import { OrderStatusTransitionService } from './core/services/order-status-transition.service';
import { OrderNormalizationService } from './core/services/order-normalization.service';
import { ProviderRegistryService } from './core/services/provider-registry.service';
import { KitchenHubHttpClient } from './providers/kitchenhub/kitchenhub-http.client';
import { KitchenHubAdapter } from './providers/kitchenhub/kitchenhub.adapter';
import { UberEatsHttpClient } from './providers/ubereats/ubereats-http.client';
import { UberEatsAdapter } from './providers/ubereats/ubereats.adapter';
import { MenuSyncService } from './sync/menu-sync.service';
import { UberEatsOnboardingController } from './onboarding/ubereats-onboarding.controller';
import { UberEatsOnboardingService } from './onboarding/ubereats-onboarding.service';
import { AggregatorWebhookController } from './webhooks/aggregator-webhook.controller';
import { UberEatsWebhookController } from './webhooks/ubereats-webhook.controller';
import { AggregatorWebhookIngestService } from './webhooks/aggregator-webhook-ingest.service';
import { AggregatorWebhookProcessor } from './queues/aggregator-webhook.processor';

/**
 * Provider-agnostic order aggregation. Imports OrdersModule to reuse the native order
 * creation + status pipeline (kitchen print, POS, reporting) so marketplace orders
 * behave like any other order. Adding a marketplace = a new adapter + a `providers`
 * row; nothing here or in OrdersModule changes.
 */
@Module({
  imports: [OrdersModule],
  controllers: [
    AggregatorController,
    AggregatorWebhookController,
    UberEatsWebhookController,
    UberEatsOnboardingController,
  ],
  providers: [
    AggregatorService,
    AggregatorRepository,
    AggregatorWebhookIngestService,
    CredentialEncryptionService,
    OrderStatusTransitionService,
    OrderNormalizationService,
    ProviderRegistryService,
    KitchenHubHttpClient,
    KitchenHubAdapter,
    UberEatsHttpClient,
    UberEatsAdapter,
    UberEatsOnboardingService,
    MenuSyncService,
    AggregatorWebhookProcessor,
  ],
  exports: [
    AggregatorService,
    CredentialEncryptionService,
    OrderStatusTransitionService,
    OrderNormalizationService,
  ],
})
export class AggregatorModule {}
