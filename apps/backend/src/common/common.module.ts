import { Module, Global } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { MailService } from './services/mail.service';
import { IdempotencyService } from './services/idempotency.service';

@Global()
@Module({
  providers: [AuditService, MailService, IdempotencyService],
  exports: [AuditService, MailService, IdempotencyService],
})
export class CommonModule {}
