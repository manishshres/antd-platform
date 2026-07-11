/**
 * Production provisioning script — run once on a fresh database.
 *
 * Seeds billing plans (idempotent) and creates the first admin user from
 * environment variables. Safe to re-run: plans use ON CONFLICT DO NOTHING
 * and the admin insert is skipped if the email already exists.
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=SecurePass1! \
 *     npx ts-node scripts/provision.ts
 *
 * Or copy creds into .env before running (DATABASE_URL is required):
 *   npx ts-node scripts/provision.ts
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as schema from '../src/database/schema';

dotenv.config({ path: resolve(__dirname, '../.env') });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_ROLE = (process.env.ADMIN_ROLE ?? 'platform_admin') as
  | 'sysadmin'
  | 'platform_admin';
const ADMIN_FIRST_NAME = process.env.ADMIN_FIRST_NAME ?? 'Admin';
const ADMIN_LAST_NAME = process.env.ADMIN_LAST_NAME ?? 'User';

async function seedPlans(
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<void> {
  const existing = await db.select().from(schema.plans).limit(1);
  if (existing.length > 0) {
    console.log('Plans already seeded — skipping.');
    return;
  }

  console.log('Seeding billing plans...');
  await db.insert(schema.plans).values([
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
      priceId: process.env.STRIPE_PRICE_GROWTH ?? 'price_growth_placeholder',
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
      priceId:
        process.env.STRIPE_PRICE_ENTERPRISE ?? 'price_enterprise_placeholder',
      voiceAgentsLimit: 100,
      monthlyMinutesLimit: 5000,
      phoneNumbersLimit: 50,
      kbSizeLimit: 1000,
      websiteImportsLimit: 100,
      orderVolumeLimit: 10000,
    },
  ]);
  console.log('✓ Plans seeded.');
}

async function provisionAdmin(
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      'ERROR: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.',
    );
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);

  if (existing) {
    console.log(`Admin ${ADMIN_EMAIL} already exists — skipping.`);
    return;
  }

  console.log(`Creating ${ADMIN_ROLE} user: ${ADMIN_EMAIL} ...`);
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.insert(schema.users).values({
    email: ADMIN_EMAIL,
    passwordHash,
    role: ADMIN_ROLE,
    firstName: ADMIN_FIRST_NAME,
    lastName: ADMIN_LAST_NAME,
    organizationId: null,
    locationId: null,
  });
  console.log(`✓ Admin created: ${ADMIN_EMAIL} (role: ${ADMIN_ROLE})`);
  console.log('  Change the password immediately after first login.');
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  // SSL follows the connection string (or DATABASE_SSL=true/false override) —
  // never NODE_ENV, which breaks self-hosted Postgres without TLS.
  const hasSsl = process.env.DATABASE_SSL
    ? process.env.DATABASE_SSL === 'true'
    : connectionString.includes('sslmode=require');

  const pool = new Pool({
    connectionString,
    ssl: hasSsl ? { rejectUnauthorized: false } : false,
  });

  const db = drizzle(pool, { schema });

  try {
    await seedPlans(db);
    await provisionAdmin(db);
    console.log('\nProvisioning complete.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
