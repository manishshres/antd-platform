import { Module, Global, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { buildRedisConnection } from '../common/redis-connection';

const queueRedisLogger = new Logger('QueueRedis');

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        // Shared with the cache client: TLS for managed hosts (Upstash refuses plaintext
        // and a redis:// URL there loops on ECONNRESET), plus the retry ceilings BullMQ
        // requires. See buildRedisConnection.
        const { url, options } = buildRedisConnection(
          configService.get<string>('REDIS_URL'),
          'queue',
          queueRedisLogger,
        );
        return {
          connection: {
            url,
            ...options,
            // Keep queueing while Redis is briefly unreachable rather than throwing.
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
      { name: 'aggregator-webhook-queue' },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
