import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrintersModule } from '../printers/printers.module';

@Module({
  imports: [PrintersModule],
  controllers: [HealthController],
})
export class HealthModule {}
