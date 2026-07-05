import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
        return {
          connection: {
            url: redisUrl,
            // BullMQ requires maxRetriesPerRequest to be null
            maxRetriesPerRequest: null,
            // Enable offline queue so operations don't immediately crash if redis is down
            enableOfflineQueue: true,
          },
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: 100, // Keep last 100 failed jobs for debugging
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'print-queue' },
      { name: 'import-queue' },
      { name: 'webhook-queue' },
      { name: 'outbound-webhooks-queue' },
      { name: 'provisioning-queue' },
      { name: 'recordings-queue' },
      { name: 'menu-ai-sync-queue' },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
