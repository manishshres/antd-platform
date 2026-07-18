// Load apps/backend/.env so DATABASE_URL from the env file is picked up — drizzle-kit
// does not read .env on its own, and without this it silently falls back to the
// localhost default below (which fails on machines without that exact local Postgres).
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/antd_db',
  },
});
