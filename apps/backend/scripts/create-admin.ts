import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/database/schema';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load the .env file explicitly
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const email = 'admin@coneeko.com';
  const password = 'changeme123!';
  const passwordHash = await bcrypt.hash(password, 12);

  console.log(`Creating platform admin for ${email}...`);

  await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      role: 'platform_admin',
    })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { role: 'platform_admin', passwordHash },
    });

  console.log(`✅ Platform admin created/updated successfully!`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
