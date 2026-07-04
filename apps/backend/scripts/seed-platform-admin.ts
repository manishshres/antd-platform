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

  console.log('Creating Platform Admin...');

  const passwordHash = await bcrypt.hash('admin123', 12);
  const [user] = await db.insert(schema.users).values({
    email: 'admin@manish.dev',
    passwordHash,
    role: 'platform_admin',
    firstName: 'Platform',
    lastName: 'Admin',
    organizationId: null,
    locationId: null,
  }).returning();

  console.log('Created User:', user.email, '(password: admin123)');

  console.log('Seeding complete.');
  process.exit(0);
}

seed().catch(console.error);
