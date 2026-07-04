import { Module, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MqttService } from './mqtt.service';
import { PrinterService } from './printer.service';
import { PrintJobsService } from './print-jobs.service';
import { PrintJobsController } from './print-jobs.controller';
import { PrintQueueProcessor } from './processors/print-queue.processor';
import { HeartbeatService } from './heartbeat.service';
import { PrintersRegistryService } from './printers-registry.service';
import { PrintersRegistryController } from './printers-registry.controller';

@Global()
@Module({
  imports: [
    // Required for @Interval decorator in HeartbeatService
    ScheduleModule.forRoot(),
  ],
  providers: [
    MqttService,
    PrinterService,
    PrintJobsService,
    PrintQueueProcessor,
    HeartbeatService,
    PrintersRegistryService,
  ],
  controllers: [PrintJobsController, PrintersRegistryController],
  exports: [
    PrinterService,
    PrintJobsService,
    PrintQueueProcessor,
    MqttService,
    PrintersRegistryService,
  ],
})
export class PrintersModule {}
