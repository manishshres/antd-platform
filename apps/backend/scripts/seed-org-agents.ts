import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/database/schema';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';

// Load .env
dotenv.config({ path: resolve(__dirname, '../.env') });

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is missing in environment variables');
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  const db = drizzle(pool, { schema });

  const locs = await db.select().from(schema.locations).where(eq(schema.locations.slug, 'makalu-main')).limit(1);
  if (!locs.length) {
    console.log('Location not found');
    process.exit(1);
  }
  const loc = locs[0];

  console.log('Seeding orgAgents and orgPhoneNumbers...');

  // Seed orgAgents
  await db.insert(schema.orgAgents).values({
    organizationId: loc.organizationId,
    locationId: loc.id,
    externalId: loc.telnyxAssistantId!,
    name: 'Makalu Assistant',
    status: 'active',
  });

  // Seed orgPhoneNumbers
  await db.insert(schema.orgPhoneNumbers).values({
    organizationId: loc.organizationId,
    locationId: loc.id,
    phoneNumber: loc.phoneNumber!,
    externalId: 'placeholder-phone-id',
    name: 'Makalu Main Line',
  });

  console.log('Done mapping agents and phone numbers.');
  process.exit(0);
}

seed().catch(console.error);
