import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { BillingModule } from '../billing/billing.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [BillingModule, CommonModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
