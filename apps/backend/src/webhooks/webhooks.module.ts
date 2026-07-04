import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookQueueProcessor } from './processors/webhook-queue.processor';

import { WebhooksManagementController } from './webhooks-management.controller';
import { WebhooksManagementService } from './webhooks-management.service';
import { OutboundWebhookProcessor } from './processors/outbound-webhook.processor';
import { OutboundWebhooksDispatcherService } from './outbound-webhooks-dispatcher.service';

@Module({
  imports: [],
  controllers: [WebhooksController, WebhooksManagementController],
  providers: [
    WebhookQueueProcessor,
    WebhooksManagementService,
    OutboundWebhookProcessor,
    OutboundWebhooksDispatcherService,
  ],
  exports: [
    WebhookQueueProcessor,
    WebhooksManagementService,
    OutboundWebhooksDispatcherService,
  ],
})
export class WebhooksModule {}
