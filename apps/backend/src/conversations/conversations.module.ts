import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { BillingModule } from '../billing/billing.module';
import { TelnyxModule } from '../telnyx/telnyx.module';

@Module({
  imports: [
    BillingModule,
    TelnyxModule,
    BullModule.registerQueue({ name: 'recordings-queue' }),
  ],
  providers: [ConversationsService],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
