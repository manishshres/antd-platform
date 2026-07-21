import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from './schema';

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

    // Aggregator reference data (providers, capabilities, order sources) is required
    // for the feature to work at all — seed it in every environment, idempotently.
    await this.seedAggregatorReferenceData();
    await this.backfillOrderSources();

    // Skip dev conveniences (default plans + admin user) in production.
    if (isProduction) {
      this.logger.log(
        'NODE_ENV=production — skipping dev seed. Provision securely.',
      );
      return;
    }

    await this.seedPlans();
    await this.seedDefaultUser();
  }

  /**
   * Seed marketplace providers, their capability matrix, and normalized order
   * sources. All inserts are idempotent (onConflictDoNothing on unique name), so
   * this is safe to run on every boot.
   */
  private async seedAggregatorReferenceData() {
    try {
      // Order sources: internal channels (existing `orders.source` values) + marketplaces.
      await this.db
        .insert(schema.orderSources)
        .values([
          { name: 'pos', type: 'internal' },
          { name: 'ai_phone', type: 'internal' },
          { name: 'online', type: 'internal' },
          { name: 'kitchenhub', type: 'marketplace' },
          { name: 'doordash', type: 'marketplace' },
          { name: 'ubereats', type: 'marketplace' },
          { name: 'grubhub', type: 'marketplace' },
        ])
        .onConflictDoNothing({ target: schema.orderSources.name });

      // Providers + their capability matrix. KitchenHub is a POS-level integration
      // that supports the full surface; the direct marketplaces we'll add later start
      // with conservative defaults, tuned once we have real API access.
      const providerSeed: {
        name: string;
        capabilities: {
          supportsOrders: boolean;
          supportsMenuSync: boolean;
          supportsDelivery: boolean;
          supportsStatusUpdates: boolean;
          supportsRefunds: boolean;
        };
      }[] = [
        {
          name: 'kitchenhub',
          capabilities: {
            supportsOrders: true,
            supportsMenuSync: true,
            supportsDelivery: true,
            supportsStatusUpdates: true,
            supportsRefunds: false,
          },
        },
        {
          name: 'doordash',
          capabilities: {
            supportsOrders: true,
            supportsMenuSync: false,
            supportsDelivery: true,
            supportsStatusUpdates: true,
            supportsRefunds: false,
          },
        },
        {
          name: 'ubereats',
          capabilities: {
            supportsOrders: true,
            supportsMenuSync: true,
            supportsDelivery: true,
            supportsStatusUpdates: true,
            supportsRefunds: false,
          },
        },
        {
          name: 'grubhub',
          capabilities: {
            supportsOrders: true,
            supportsMenuSync: false,
            supportsDelivery: false,
            supportsStatusUpdates: true,
            supportsRefunds: false,
          },
        },
      ];

      for (const p of providerSeed) {
        await this.db
          .insert(schema.providers)
          .values({ name: p.name })
          .onConflictDoNothing({ target: schema.providers.name });

        const [provider] = await this.db
          .select({ id: schema.providers.id })
          .from(schema.providers)
          .where(eq(schema.providers.name, p.name))
          .limit(1);
        if (!provider) continue;

        await this.db
          .insert(schema.providerCapabilities)
          .values({ providerId: provider.id, ...p.capabilities })
          .onConflictDoNothing({
            target: schema.providerCapabilities.providerId,
          });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to seed aggregator reference data (database may not be ready): ${message}`,
      );
    }
  }

  /**
   * One-time (idempotent) backfill: link existing orders' legacy `source` varchar
   * to the normalized `order_sources` row. Only touches rows where sourceId is still
   * null, so it converges to a no-op once complete.
   */
  private async backfillOrderSources() {
    try {
      const sources = await this.db
        .select({ id: schema.orderSources.id, name: schema.orderSources.name })
        .from(schema.orderSources);

      for (const source of sources) {
        await this.db
          .update(schema.orders)
          .set({ sourceId: source.id })
          .where(
            and(
              eq(schema.orders.source, source.name),
              isNull(schema.orders.sourceId),
            ),
          );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to backfill order sources: ${message}`);
    }
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
