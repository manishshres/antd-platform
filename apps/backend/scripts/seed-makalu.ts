import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/database/schema';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

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

  console.log('Seeding Makalu Indian Cuisine...');

  // 1. Create Organization
  const [org] = await db.insert(schema.organizations).values({
    name: 'Makalu Indian Cuisine',
    slug: 'makalu-indian-cuisine',
    status: 'active',
  }).returning();

  console.log('Created Org:', org.id);

  // 2. Create Location
  const [loc] = await db.insert(schema.locations).values({
    organizationId: org.id,
    name: 'Main Location',
    slug: 'makalu-main',
    address: '123 South Broad St',
    city: 'Philadelphia',
    state: 'PA',
    country: 'US',
    postalCode: '19109',
    timezone: 'America/New_York',
    phoneNumber: '+18706859294',
    telnyxAssistantId: 'assistant-5966713f-9eb2-4b68-bdda-22a1fd4820b3',
    status: 'active',
  }).returning();

  console.log('Created Location:', loc.id);

  // 3. Create User
  const passwordHash = await bcrypt.hash('password123!', 12);
  const [user] = await db.insert(schema.users).values({
    email: 'mr.manishshrestha@gmail.com',
    passwordHash,
    role: 'sysadmin',
    firstName: 'Amin',
    lastName: '',
    organizationId: org.id,
    locationId: loc.id,
  }).returning();

  console.log('Created User:', user.email, '(password: password123!)');

  console.log('Seeding complete.');
  process.exit(0);
}

seed().catch(console.error);
