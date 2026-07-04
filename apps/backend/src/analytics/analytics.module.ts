import { Module, Global } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DatabaseModule } from '../database/database.module';
import { BillingModule } from '../billing/billing.module';

@Global()
@Module({
  imports: [DatabaseModule, BillingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
