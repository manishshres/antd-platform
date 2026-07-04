import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StripeModule } from './stripe/stripe.module';
import { BillingModule } from './billing/billing.module';

import { SentryModule } from '@sentry/nestjs/setup';
import { TelnyxModule } from './telnyx/telnyx.module';
import { AgentsModule } from './agents/agents.module';
import { CallsModule } from './calls/calls.module';
import { DocumentsModule } from './documents/documents.module';
import { MenusModule } from './menus/menus.module';
import { OrdersModule } from './orders/orders.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PrintersModule } from './printers/printers.module';
import { QueuesModule } from './queues/queues.module';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { InvitationsModule } from './invitations/invitations.module';
import { LocationsModule } from './locations/locations.module';
import { CronModule } from './cron/cron.module';
import { StorageModule } from './storage/storage.module';
import { RecordingsModule } from './recordings/recordings.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { EventsModule } from './events/events.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicApiModule } from './public-api/public-api.module';

import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConversationsModule } from './conversations/conversations.module';
import { CacheModule } from '@nestjs/cache-manager';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import * as redisStore from 'cache-manager-ioredis';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        store: redisStore,
        url: configService.get<string>('REDIS_URL') || 'redis://localhost:6379',
        ttl: 3600, // default cache for 1 hour
      }),
    }),
    SentryModule.forRoot(),
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrometheusModule.register(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
      },
      forRoutes: ['*path'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        errorMessage: configService.get<string>(
          'THROTTLE_ERROR_MESSAGE',
          'Too many requests. Please try again later.',
        ),
        throttlers: [
          {
            name: 'default',
            ttl: configService.get<number>('THROTTLE_DEFAULT_TTL', 60000),
            limit: configService.get<number>('THROTTLE_DEFAULT_LIMIT', 5),
          },
          {
            name: 'account',
            ttl: configService.get<number>('THROTTLE_ACCOUNT_TTL', 60000),
            limit: configService.get<number>('THROTTLE_ACCOUNT_LIMIT', 3),
          },
        ],
      }),
    }),
    DatabaseModule,
    CommonModule,
    AuthModule,
    UsersModule,
    StripeModule,
    BillingModule,
    TelnyxModule,
    AgentsModule,
    CallsModule,
    DocumentsModule,
    MenusModule,
    OrdersModule,
    WebhooksModule,
    PrintersModule,
    QueuesModule,
    HealthModule,
    OrganizationsModule,
    ProvisioningModule,
    InvitationsModule,
    LocationsModule,
    CronModule,
    StorageModule,
    RecordingsModule,
    AnalyticsModule,
    EventsModule,
    NotificationsModule,
    ApiKeysModule,
    PublicApiModule,
    ConversationsModule,
    AuditLogsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
