import { Client } from 'pg';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

export default async () => {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });

  const defaultUrl =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/antd';
  // Connect to the default 'postgres' database to create the test database
  const baseUrl = defaultUrl.replace(/\/[^/]+$/, '/postgres');
  const testUrl = defaultUrl.replace(/\/[^/]+$/, '/antd_test');

  process.env.DATABASE_URL = testUrl;

  const client = new Client({ connectionString: baseUrl });
  try {
    await client.connect();
    // Drop test database if it exists
    await client.query('DROP DATABASE IF EXISTS antd_test WITH (FORCE);');
    await client.query('CREATE DATABASE antd_test;');
    console.log('Created antd_test database');
  } catch (error) {
    console.error('Failed to create test database:', error);
    throw error;
  } finally {
    await client.end();
  }

  console.log('Running migrations on test database...');
  execSync('npx drizzle-kit push', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
};
