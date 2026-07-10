import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { DRIZZLE } from './database.module';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @Inject('DRIZZLE')
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    // Skip seeding entirely in production when this module is imported.
    // In non-prod, seed defaults.
    if (isProduction) {
      this.logger.log(
        'NODE_ENV=production — skipping seed. Provision securely.',
      );
      return;
    }

    await this.seedPlans();
    await this.seedDefaultUser();
  }

  private async seedPlans() {
    try {
      const existing = await this.db.select().from(schema.plans).limit(1);
      if (existing.length > 0) return;

      this.logger.log('Seeding default plans...');
      await this.db.insert(schema.plans).values([
        {
          id: 'free',
          name: 'Free Plan',
          priceId: null,
          voiceAgentsLimit: 1,
          monthlyMinutesLimit: 30,
          phoneNumbersLimit: 1,
          kbSizeLimit: 10,
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
          kbSizeLimit: 100,
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
          kbSizeLimit: 1000,
          websiteImportsLimit: 100,
          orderVolumeLimit: 10000,
        },
      ]);
      this.logger.log('Seeding default plans completed.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to seed default plans (database may not be ready): ${message}`,
      );
    }
  }

  private async seedDefaultUser() {
    try {
      const existing = await this.db.select().from(schema.users).limit(1);
      if (existing.length > 0) return;

      this.logger.log('Seeding default test user...');
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('changeme123!', 12);
      await this.db.insert(schema.users).values({
        email: 'test@example.com',
        passwordHash,
        role: 'admin',
      });
      this.logger.log(
        'Seeding default test user completed. IMPORTANT: change the password immediately.',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to seed default user (database may not be ready): ${message}`,
      );
    }
  }
}
