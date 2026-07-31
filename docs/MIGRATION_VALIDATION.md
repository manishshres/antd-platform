# Drizzle Migration Validation System

## Overview

This project now enforces strict validation of Drizzle migrations through automated pre-commit hooks and manual validation scripts. This prevents the silent-failure scenario where `.sql` migration files exist without journal entries, causing migrations to never run in production.

---

## What Was Fixed

### Issue 1: Missing Migration Journal Validation ✅

**Problem**: Migration `0026_add_category_to_modifiers.sql` existed on disk without a corresponding entry in `drizzle/meta/_journal.json`. This caused `npx drizzle-kit migrate` to silently skip it in production, risking data schema misalignment.

**Root cause**: No automated validation ensured that every `.sql` file had a journal entry with a matching index.

**Solution**: 
- Added `scripts/validate-migrations.mjs` — validates that:
  - Every `.sql` migration has a journal entry with matching `idx`
  - Journal indices are sequential (no gaps)
  - No orphaned journal entries exist
  
- Pre-commit hook automatically runs this validation when migration files change.

---

### Issue 2: Stale Drizzle Snapshots ✅

**Problem**: The `0031_snapshot.json` file was manually regenerated after fixing drizzle-kit. If developers modify `schema.ts` without running `npx drizzle-kit generate`, the snapshot becomes stale and out of sync with the actual schema.

**Root cause**: No automation enforced snapshot regeneration when schema changes.

**Solution**:
- Added `scripts/validate-drizzle-snapshot.mjs` — validates that the snapshot is newer than `schema.ts`
- Pre-commit hook automatically runs this validation when schema changes
- Developers are prompted to run `npx drizzle-kit generate` if snapshot is stale

---

## How to Use

### Automatic Validation (Pre-Commit Hooks)

When you try to commit, husky's pre-commit hook automatically runs validation:

```bash
git add apps/backend/drizzle/migrations/0032_new_table.sql
git add apps/backend/drizzle/meta/_journal.json
git commit -m "feat(db): add new_table migration"

# Pre-commit hook runs:
# ✅ Migration validation passes
# ✅ Snapshot validation passes
# ✔️  Commit succeeds
```

### If Validation Fails

```bash
git add apps/backend/src/database/schema.ts
git commit -m "feat(db): add column to users table"

# Pre-commit hook runs:
# ❌ Snapshot is stale (schema.ts was modified more recently than snapshot)
# 💡 Pre-commit hook suggests fix:
#    Run: npx drizzle-kit generate
```

**Fix it:**

```bash
cd apps/backend
npx drizzle-kit generate
git add drizzle/meta/0032_snapshot.json
git commit -m "feat(db): add column to users table"
```

### Manual Validation

Run validation anytime, even outside of git commits:

```bash
# Validate all migrations and journal entries
node scripts/validate-migrations.mjs

# Validate snapshot is in sync
node scripts/validate-drizzle-snapshot.mjs
```

---

## Validation Rules

### Migration Validation (`validate-migrations.mjs`)

Ensures:

1. **Filename format**: `NNNN_description.sql` (4-digit zero-padded index + description)
   - ✅ `0032_add_users_table.sql`
   - ❌ `32_add_users_table.sql` (not zero-padded)
   - ❌ `0032AddUsersTable.sql` (description not snake_case)

2. **Journal entry exists**: Every `.sql` file has a corresponding entry in `_journal.json`
   - ❌ File: `0032_add_users_table.sql`, but no entry with `idx: 32` in journal

3. **Index matches**: The filename's numeric prefix matches the journal entry's `idx`
   - ❌ File: `0032_add_users_table.sql`, but journal entry has `idx: 33`

4. **Tag matches**: The journal entry's `tag` field matches the filename's description part
   - ❌ File: `0032_add_users_table.sql`, but journal entry has `tag: "add_users_column"`

5. **Sequential indices**: No gaps or jumps in journal indices (0, 1, 2, ..., N)
   - ❌ Journal has entries for 0, 1, 2, 4, 5 (missing 3)

6. **No orphaned entries**: Every journal entry has a corresponding `.sql` file
   - ❌ Journal entry `idx: 99 tag: "future_migration"` but no `0099_future_migration.sql` file

### Snapshot Validation (`validate-drizzle-snapshot.mjs`)

Ensures:

1. **Snapshot exists**: At least one snapshot file in `drizzle/meta/NNNN_snapshot.json`
   - ❌ Directory is empty or missing

2. **Up-to-date**: The latest snapshot is newer than (or same age as) `schema.ts`
   - ❌ `schema.ts` modified at 2024-07-30 10:00
   - ❌ Latest snapshot `0031_snapshot.json` modified at 2024-07-30 09:00

---

## Troubleshooting

### "Migration validation FAILED"

```
❌ Missing journal entry for migration 0032_add_users_table.sql
```

**Fix**: Add an entry to `apps/backend/drizzle/meta/_journal.json`:

```json
{
  "idx": 32,
  "tag": "add_users_table",
  "when": 1690000000000
}
```

Then commit.

---

### "Snapshot validation FAILED"

```
❌ Snapshot is stale:
   schema.ts modified: 2024-07-30T10:00:00.000Z
   snapshot (0031_snapshot.json) modified: 2024-07-30T09:00:00.000Z
```

**Fix**: Regenerate the snapshot:

```bash
cd apps/backend
npx drizzle-kit generate
git add drizzle/meta/0032_snapshot.json
git commit
```

---

### Pre-Commit Hook Doesn't Run

If the hook is not triggered during commit:

1. Verify husky is installed:
   ```bash
   ls -la .husky/
   ```

2. Verify pre-commit hook is executable:
   ```bash
   chmod +x .husky/pre-commit
   ```

3. Reinstall husky:
   ```bash
   npm install
   ```

4. Manually run validation:
   ```bash
   node scripts/validate-migrations.mjs
   node scripts/validate-drizzle-snapshot.mjs
   ```

---

### "Journal indices are not sequential"

```
❌ Journal indices are not sequential: expected index 2 but found 4
```

This means entries got deleted or corrupted. **Do not manually edit `_journal.json`.** Instead:

1. Restore from Git history:
   ```bash
   git checkout HEAD -- apps/backend/drizzle/meta/_journal.json
   ```

2. If migration was truly bad, delete the `.sql` file and regenerate:
   ```bash
   rm apps/backend/drizzle/migrations/0032_bad_migration.sql
   npx drizzle-kit generate
   ```

---

## CI Integration

The `.github/workflows/ci.yml` should include validation:

```yaml
- name: Validate Drizzle Migrations
  run: node scripts/validate-migrations.mjs

- name: Validate Drizzle Snapshot
  run: node scripts/validate-drizzle-snapshot.mjs
```

This ensures migrations are valid before merging to main/master.

---

## Design Principles

1. **Fail fast**: Validation happens before commit, not in production.
2. **Automate enforcement**: Pre-commit hooks reduce human error.
3. **Clear error messages**: Developers understand what went wrong and how to fix it.
4. **Safety first**: No silent failures; migrations always run or the commit fails.
5. **No manual journal editing**: Only drizzle-kit should modify the journal.

---

## Related Documentation

- `/docs/DEPENDENCY_HOISTING.md` — Why drizzle-orm/pg are duplicated at root
- `/docs/DRIZZLE_SNAPSHOTS.md` — Schema snapshot management and repository bloat
- `/apps/backend/CLAUDE.md` — Full backend coding guidelines
