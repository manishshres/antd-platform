import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SeedModule } from './database/seed.module';
import { CommonModule } from './common/common.module';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StripeModule } from './stripe/stripe.module';
import { BillingModule } from './billing/billing.module';

import { SentryModule } from '@sentry/nestjs/setup';
import { TelnyxModule } from './telnyx/telnyx.module';
import { CustomersModule } from './customers/customers.module';
import { TablesModule } from './tables/tables.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PrintersModule } from './printers/printers.module';
import { QueuesModule } from './queues/queues.module';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AgentsModule } from './agents/agents.module';
import { CallsModule } from './calls/calls.module';
import { DocumentsModule } from './documents/documents.module';
import { MenusModule } from './menus/menus.module';
import { OrdersModule } from './orders/orders.module';
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
import { DiscountsModule } from './discounts/discounts.module';
import { CacheModule } from '@nestjs/cache-manager';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AggregatorModule } from './aggregator/aggregator.module';
import * as redisStore from 'cache-manager-ioredis';
import Redis from 'ioredis';
import { validateEnv } from './config/env.validation';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { createThrottleSkipIf } from './common/throttle-skip';
import { RootController } from './root.controller';
import { GlobalJwtAuthGuard } from './auth/guards/global-jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

const isProduction = process.env.NODE_ENV === 'production';

// pino-pretty is a devDependency, so it is absent from the production image.
// Resolve it before asking pino to load it — otherwise a container that boots
// without NODE_ENV=production dies at startup on "unable to determine transport
// target for pino-pretty" instead of just logging JSON.
const prettyTransport = ((): { target: string } | undefined => {
  if (isProduction) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty' };
  } catch {
    return undefined;
  }
})();

@Module({
  imports: [
    // ── Core infrastructure
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        store: redisStore,
        // cache-manager-ioredis hands this options object straight to
        // `new Redis(opts)`, and ioredis ignores an unrecognised `url` key — a
        // `url:` here silently connected to localhost:6379 no matter what
        // REDIS_URL said. Build the client from the URL ourselves.
        redisInstance: new Redis(
          configService.get<string>('REDIS_URL') || 'redis://localhost:6379',
        ),
        ttl: 3600,
      }),
    }),
    ScheduleModule.forRoot(),
    PrometheusModule.register(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProduction ? 'info' : 'debug',
        transport: prettyTransport,
      },
      forRoutes: ['*path'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Plain Reflector — `skipIf` runs outside DI, and metadata lookup needs no state.
        const throttleReflector = new Reflector();
        return {
          errorMessage: configService.get<string>(
            'THROTTLE_ERROR_MESSAGE',
            'Too many requests. Please try again later.',
          ),
          // Master switch — see createThrottleSkipIf. Rate limiting is off by default
          // while the Voice AI flow is built out; routes carrying @EnforceThrottle()
          // (password login, POS PIN entry) stay limited regardless.
          skipIf: createThrottleSkipIf(configService, throttleReflector),
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
        };
      },
    }),
    SentryModule.forRoot(),
    EventEmitterModule.forRoot(),

    // ── Data layer
    DatabaseModule,
    SeedModule,
    CommonModule,

    // ── Auth & Identity
    AuthModule,
    UsersModule,
    ApiKeysModule,
    PublicApiModule,

    // ── Billing
    StripeModule,
    BillingModule,

    // ── Multi-tenancy
    OrganizationsModule,
    InvitationsModule,
    ProvisioningModule,
    LocationsModule,

    // ── Core features
    OrdersModule,
    MenusModule,
    DiscountsModule,
    CustomersModule,
    TablesModule,

    // ── AI & Voice
    AgentsModule,
    CallsModule,
    ConversationsModule,
    DocumentsModule,
    RecordingsModule,
    TelnyxModule,

    // ── Infrastructure features
    PrintersModule,
    QueuesModule,
    WebhooksModule,
    StorageModule,
    NotificationsModule,
    EventsModule,
    AnalyticsModule,

    // ── Operations
    HealthModule,
    CronModule,
    AuditLogsModule,

    // ── Order aggregation (marketplace integrations: KitchenHub, DoorDash, ...)
    AggregatorModule,
  ],
  controllers: [AppController, RootController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: GlobalJwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
