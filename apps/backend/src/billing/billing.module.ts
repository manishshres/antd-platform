import { Module, Global } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeModule } from '../stripe/stripe.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
  imports: [DatabaseModule, StripeModule],
  controllers: [BillingController],
  providers: [BillingService, InvoicePdfService],
  exports: [BillingService, InvoicePdfService],
})
export class BillingModule {}
