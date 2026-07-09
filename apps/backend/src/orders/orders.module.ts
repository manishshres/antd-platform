import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderPricingService } from './order-pricing.service';
import { OrderPrintService } from './order-print.service';
import { OrderPaymentService } from './order-payment.service';
import { BillingModule } from '../billing/billing.module';
import { QueuesModule } from '../queues/queues.module';
import { PrintersModule } from '../printers/printers.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [BillingModule, QueuesModule, PrintersModule, UsersModule],
  controllers: [OrdersController],
  providers: [
    OrderPricingService,
    OrderPrintService,
    OrderPaymentService,
    OrdersService,
  ],
  exports: [OrdersService, OrderPaymentService],
})
export class OrdersModule {}
