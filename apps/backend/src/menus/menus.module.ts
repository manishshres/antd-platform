import { Module } from '@nestjs/common';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';
import { BillingModule } from '../billing/billing.module';
import { CrawlerService } from './crawler.service';
import { AiExtractorService } from './ai-extractor.service';
import { ImportQueueProcessor } from './processors/import-queue.processor';
import { TelnyxModule } from '../telnyx/telnyx.module';
import { StorageModule } from '../storage/storage.module';
import { PlanLimitGuard } from '../billing/guards/plan-limit.guard';

@Module({
  imports: [BillingModule, TelnyxModule, StorageModule],
  controllers: [MenusController],
  providers: [
    MenusService,
    CrawlerService,
    AiExtractorService,
    ImportQueueProcessor,
    PlanLimitGuard,
  ],
  exports: [MenusService, ImportQueueProcessor],
})
export class MenusModule {}
