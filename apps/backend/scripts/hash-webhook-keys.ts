import { Pool } from 'pg';
import { createHash } from 'crypto';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env
dotenv.config({ path: resolve(__dirname, '../.env') });

async function runMigration() {
  console.log('Starting webhook API key hashing migration...');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch all organizations with a plaintext webhook API key
    // We assume any key starting with "sk_live_" but not 64 chars long (SHA-256 hex length is 64) is plaintext
    // However, for safety, if it's 64 characters it might already be hashed.
    const { rows } = await client.query(`
      SELECT id, webhook_api_key 
      FROM organizations 
      WHERE webhook_api_key IS NOT NULL 
        AND length(webhook_api_key) != 64
    `);

    console.log(`Found ${rows.length} organizations requiring API key migration.`);

    for (const org of rows) {
      const plaintextKey = org.webhook_api_key;
      const hashedKey = createHash('sha256').update(plaintextKey).digest('hex');

      await client.query(
        'UPDATE organizations SET webhook_api_key = $1 WHERE id = $2',
        [hashedKey, org.id]
      );
      console.log(`Migrated API key for organization: ${org.id}`);
    }

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
