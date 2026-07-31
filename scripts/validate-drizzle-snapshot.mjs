#!/usr/bin/env node
/**
 * Validates that Drizzle snapshot is in sync with schema.ts
 * If snapshots are stale (schema.ts modified more recently), errors out.
 *
 * Exit code: 0 if valid, 1 if snapshot is stale
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..', 'apps', 'backend');
const schemaPath = path.join(backendDir, 'src', 'database', 'schema.ts');
const metaDir = path.join(backendDir, 'drizzle', 'meta');

let errors = [];

// 1. Check that schema.ts exists
if (!fs.existsSync(schemaPath)) {
  console.error('❌ Schema file not found:', schemaPath);
  process.exit(1);
}

// 2. Find the most recent snapshot file
if (!fs.existsSync(metaDir)) {
  console.error('❌ Drizzle meta directory not found:', metaDir);
  process.exit(1);
}

const snapshots = fs.readdirSync(metaDir)
  .filter(f => f.match(/^\d{4}_snapshot\.json$/))
  .sort()
  .reverse();

if (snapshots.length === 0) {
  console.error('❌ No snapshot files found in drizzle/meta/');
  process.exit(1);
}

const latestSnapshot = snapshots[0];
const snapshotPath = path.join(metaDir, latestSnapshot);

// 3. Compare modification times
const schemaStat = fs.statSync(schemaPath);
const snapshotStat = fs.statSync(snapshotPath);

if (schemaStat.mtime > snapshotStat.mtime) {
  errors.push(
    `❌ Snapshot is stale:\n` +
    `   schema.ts modified: ${schemaStat.mtime.toISOString()}\n` +
    `   snapshot (${latestSnapshot}) modified: ${snapshotStat.mtime.toISOString()}`
  );
}

// Report results
if (errors.length > 0) {
  console.error('\n🔴 Snapshot validation FAILED:\n');
  errors.forEach(err => console.error(err));
  console.error('\n💡 Fix:\n');
  console.error('   Run: npx drizzle-kit generate (from apps/backend/)\n');
  process.exit(1);
} else {
  console.log('✅ Drizzle snapshot is in sync');
  console.log(`   Latest snapshot: ${latestSnapshot}`);
  process.exit(0);
}
