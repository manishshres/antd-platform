import { Module } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsController } from './audit-logs.controller';

@Module({
  providers: [AuditLogsService],
  controllers: [AuditLogsController],
})
export class AuditLogsModule {}
