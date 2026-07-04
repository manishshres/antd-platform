import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronService } from './cron.service';

import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule, ScheduleModule.forRoot()],
  providers: [CronService],
})
export class CronModule {}
