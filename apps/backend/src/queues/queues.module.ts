import { Module, Global, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { buildRedisConnection } from '../common/redis-connection';

const queueRedisLogger = new Logger('QueueRedis');

/**
 * Worker tuning shared by every processor.
 *
 * A BullMQ worker waits for jobs with `BZPOPMIN <marker> <drainDelay>`; when a job is
 * added, the marker is pushed and the block returns immediately. `drainDelay` is therefore
 * only how long an *idle* worker blocks before re-issuing the command — raising it does not
 * delay job pickup at all. At the 5s default, 8 idle queues cost 8 × 86400/5 ≈ 138k
 * commands a day doing nothing; at 60s that is ~11.5k. Upstash bills per command.
 *
 * `stalledInterval` is the sweep that reclaims jobs from workers that died mid-job. The
 * tradeoff is bounded: a crashed worker's job now waits up to 5 minutes to be retried
 * instead of 30 seconds. `print-queue` overrides it back to 30s — a kitchen ticket cannot
 * wait five minutes — and pays ~2.9k commands a day for it.
 */
export const SHARED_WORKER_OPTIONS = {
  drainDelay: 60,
  stalledInterval: 300_000,
} as const;

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
