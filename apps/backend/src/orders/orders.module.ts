import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { BillingModule } from '../billing/billing.module';
import { QueuesModule } from '../queues/queues.module';
import { PrintersModule } from '../printers/printers.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [BillingModule, QueuesModule, PrintersModule, UsersModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
