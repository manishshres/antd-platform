import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RecordingsProcessor } from './recordings.processor';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { StorageModule } from '../storage/storage.module';
import { TelnyxModule } from '../telnyx/telnyx.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BillingModule } from '../billing/billing.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'recordings-queue' }),
    StorageModule,
    TelnyxModule,
    AnalyticsModule,
    BillingModule,
    CommonModule,
  ],
  controllers: [RecordingsController],
  providers: [RecordingsProcessor, RecordingsService],
})
export class RecordingsModule {}
