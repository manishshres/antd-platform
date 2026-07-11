import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const DRIZZLE = 'DRIZZLE';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString = configService.get<string>('DATABASE_URL');

        // SSL is decided by the connection string (managed Postgres like Neon/RDS
        // uses ?sslmode=require), optionally overridden by DATABASE_SSL=true/false.
        // Never force it from NODE_ENV: a self-hosted dockerized Postgres has no
        // TLS, and forcing SSL there makes every query fail in production.
        const sslOverride = configService.get<string>('DATABASE_SSL');
        const hasSsl = sslOverride
          ? sslOverride === 'true'
          : (connectionString?.includes('sslmode=require') ?? false);

        const pool = new Pool({
          connectionString,
          ssl: hasSsl ? { rejectUnauthorized: false } : false,
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {
  private readonly logger = new Logger(DatabaseModule.name);
}
