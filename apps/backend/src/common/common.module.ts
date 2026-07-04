import { Module, Global } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { MailService } from './services/mail.service';

@Global()
@Module({
  providers: [AuditService, MailService],
  exports: [AuditService, MailService],
})
export class CommonModule {}
