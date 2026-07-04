import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  providers: [ConversationsService],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
