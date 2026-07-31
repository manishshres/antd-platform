#!/usr/bin/env node
/**
 * Validates that all Drizzle migration .sql files have corresponding journal entries
 * with matching indices. Run before committing migration changes.
 *
 * Exit code: 0 if valid, 1 if issues found
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..', 'apps', 'backend');
const migrationsDir = path.join(backendDir, 'drizzle');
const journalPath = path.join(backendDir, 'drizzle', 'meta', '_journal.json');

let errors = [];

// 1. Load the journal
if (!fs.existsSync(journalPath)) {
  console.error('❌ Migration journal not found:', journalPath);
  process.exit(1);
}

let journal;
try {
  const journalText = fs.readFileSync(journalPath, 'utf-8');
  journal = JSON.parse(journalText);
} catch (e) {
  console.error('❌ Failed to parse journal:', e.message);
  process.exit(1);
}

// 2. Get list of .sql migration files
if (!fs.existsSync(migrationsDir)) {
  console.error('❌ Migrations directory not found:', migrationsDir);
  process.exit(1);
}

const sqlFiles = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

// 3. Extract numeric prefix and tag from each .sql file
const sqlMigrations = sqlFiles.map(filename => {
  const match = filename.match(/^(\d+)_(.+)\.sql$/);
  if (!match) {
    errors.push(`❌ Invalid migration filename format: ${filename} (expected: NNNN_name.sql)`);
    return null;
  }
  const idx = parseInt(match[1], 10);
  const filenameWithoutExtension = filename.replace('.sql', '');
  return {
    filename,
    idx,
    expectedTag: filenameWithoutExtension, // e.g., "0032_add_table"
  };
}).filter(Boolean);

// 4. Check that each .sql file has a corresponding journal entry
const journalEntries = new Map(journal.entries.map(e => [e.idx, e]));

for (const sql of sqlMigrations) {
  const entry = journalEntries.get(sql.idx);

  if (!entry) {
    errors.push(`❌ Missing journal entry for migration ${sql.filename}`);
  } else if (entry.tag !== sql.expectedTag) {
    errors.push(
      `❌ Journal entry mismatch for migration ${sql.idx}:\n` +
      `   File: ${sql.filename} → expected tag: ${sql.expectedTag}\n` +
      `   Journal: idx ${entry.idx} → actual tag: ${entry.tag}`
    );
  }
}

// 5. Check that each journal entry has a corresponding .sql file
for (const entry of journal.entries) {
  const expectedFilename = `${String(entry.idx).padStart(4, '0')}_${entry.tag}.sql`;
  const sqlFile = sqlMigrations.find(m => m.idx === entry.idx);

  if (!sqlFile) {
    errors.push(`❌ Journal entry has no corresponding migration file: ${entry.idx} (${entry.tag})`);
  }
}

// 6. Check that journal indices are sequential
const sortedIndices = journal.entries.map(e => e.idx).sort((a, b) => a - b);
for (let i = 0; i < sortedIndices.length; i++) {
  if (sortedIndices[i] !== i) {
    errors.push(
      `❌ Journal indices are not sequential: expected index ${i} but found ${sortedIndices[i]}`
    );
  }
}

// Report results
if (errors.length > 0) {
  console.error('\n🔴 Migration validation FAILED:\n');
  errors.forEach(err => console.error(err));
  console.error('\n💡 Fix:\n');
  console.error('   1. Ensure every .sql file has an entry in drizzle/meta/_journal.json');
  console.error('   2. Ensure the idx in each journal entry matches the numeric prefix of the .sql filename');
  console.error('   3. Run: npx drizzle-kit generate (from apps/backend/)\n');
  process.exit(1);
} else {
  console.log('✅ Migration validation passed');
  console.log(`   ${sqlFiles.length} migration(s) found, all with valid journal entries`);
  process.exit(0);
}
