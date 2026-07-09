import {
  Module,
  Global,
  OnApplicationBootstrap,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
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
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';

        // For Neon Postgres or self-hosted prod, enable SSL if connection url specifies it or if in production
        const hasSsl =
          connectionString?.includes('sslmode=require') || isProduction;

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
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const existing = await this.db.select().from(schema.plans).limit(1);
      if (existing.length === 0) {
        this.logger.log('Seeding default plans...');
        await this.db.insert(schema.plans).values([
          {
            id: 'free',
            name: 'Free Plan',
            priceId: null,
            voiceAgentsLimit: 1,
            monthlyMinutesLimit: 30,
            phoneNumbersLimit: 1,
            kbSizeLimit: 10, // 10MB
            websiteImportsLimit: 1,
            orderVolumeLimit: 50,
          },
          {
            id: 'growth',
            name: 'Growth Plan',
            priceId: 'price_growth_placeholder',
            voiceAgentsLimit: 5,
            monthlyMinutesLimit: 500,
            phoneNumbersLimit: 3,
            kbSizeLimit: 100, // 100MB
            websiteImportsLimit: 10,
            orderVolumeLimit: 500,
          },
          {
            id: 'enterprise',
            name: 'Enterprise Plan',
            priceId: 'price_enterprise_placeholder',
            voiceAgentsLimit: 100,
            monthlyMinutesLimit: 5000,
            phoneNumbersLimit: 50,
            kbSizeLimit: 1000, // 1GB
            websiteImportsLimit: 100,
            orderVolumeLimit: 10000,
          },
        ]);
        this.logger.log('Seeding default plans completed.');
      }

      const isProduction =
        this.configService.get<string>('NODE_ENV') === 'production';
      const existingUsers = await this.db.select().from(schema.users).limit(1);
      if (existingUsers.length === 0) {
        if (isProduction) {
          // Never seed a known-credential admin into a production database.
          // The first admin must be created through a secure provisioning step.
          this.logger.warn(
            'No users found and NODE_ENV=production — skipping default-user seed. Provision the first admin securely.',
          );
        } else {
          this.logger.log('Seeding default test user...');
          // Use async bcrypt.hash (never sync on bootstrap — avoids blocking event loop)
          const bcrypt = await import('bcrypt');
          const passwordHash = await bcrypt.hash('changeme123!', 12);
          await this.db.insert(schema.users).values({
            email: 'test@example.com',
            passwordHash,
            role: 'admin', // Seed as admin so they can test everything
          });
          this.logger.log(
            'Seeding default test user completed. IMPORTANT: change the password immediately.',
          );
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to seed default plans/users (database connection may not be established yet): ${message}`,
      );
    }
  }
}
