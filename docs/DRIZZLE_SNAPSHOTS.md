# Drizzle Schema Snapshots: Repository Bloat Management

## Overview

Drizzle ORM generates schema snapshots (`drizzle/meta/0NNN_snapshot.json`) to track database schema evolution. Each snapshot is a complete representation of your database schema at that migration point.

### Current Status

- **26 migrations** completed (0000 through 0031)
- **26 snapshot files** in `apps/backend/drizzle/meta/`
- **~2.6 MB** total snapshot storage in Git history

Each snapshot is **91 KB – 165 KB** on disk.

---

## Why Snapshots Are Committed

Drizzle's design requires committing snapshots to version control because:

1. **Migration verification** — drizzle-kit compares the schema.ts against snapshots to detect schema drift.
2. **Type safety** — snapshot files enable strict typing in migrations.
3. **Audit trail** — snapshots serve as a historical record of schema evolution.

**Removing snapshots will break migrations and type checking.**

---

## The Repository Bloat Problem

As your database schema evolves over months/years, snapshots accumulate:

- 10 migrations = ~1 MB
- 50 migrations = ~5 MB
- 100 migrations = ~10 MB

For a long-lived production system, this becomes significant repository bloat, slowing clones and increasing storage costs.

---

## Mitigation Strategies

### Strategy 1: Snapshot Pruning (Recommended)

Periodically remove old snapshots while keeping the latest few. This **requires a one-time manual effort** but is safe and reduces bloat.

#### How It Works

1. Keep only the **most recent 3–5 snapshots** in Git.
2. Delete older snapshots (git rm, not just delete).
3. Drizzle will regenerate missing intermediate snapshots on demand during migrations.

#### Steps

```bash
cd apps/backend/drizzle/meta

# List snapshots in reverse chronological order
ls -1 *_snapshot.json | sort -r

# Keep the latest 3 (e.g., 0031, 0030, 0029)
# Delete the older ones
git rm 0028_snapshot.json 0027_snapshot.json ... 0000_snapshot.json

# Commit
git add -A
git commit -m "chore(db): prune old drizzle snapshots (keep last 3)"

# Verify migrations still work
npx drizzle-kit generate
npx drizzle-kit migrate
```

#### Pros
- Reduces repository size immediately.
- Safe — Drizzle regenerates snapshots as needed.

#### Cons
- One-time manual effort.
- Requires coordination if multiple devs are working on migrations.

### Strategy 2: Store Snapshots Outside Git

Move snapshots to cloud storage (S3, GCS) and reference them from CI/migrations.

#### Pros
- Completely decouples repository size from schema history.
- Migrations still work.

#### Cons
- Adds build complexity.
- Requires CI/CD setup.
- Not needed unless snapshots become truly massive.

### Strategy 3: .gitignore (NOT Recommended)

Ignore snapshots in Git and rely on `npx drizzle-kit generate` to recreate them.

#### Why This is Dangerous
- **Breaking change for team members** — their snapshot files won't match the committed schema, causing confusing migration failures.
- **CI will regenerate differently** — if Git doesn't track snapshots, CI and local developer environments can diverge.
- **Type safety lost** — snapshots provide Drizzle's type information for migration verification.

**Do not do this.**

---

## Current Recommendation

**For now**, keep all snapshots in Git. Once the schema stabilizes or the repository starts feeling slow:

1. **Prune old snapshots** using Strategy 1.
2. **Consider Strategy 2** if snapshots exceed 10+ MB.

### Snapshot Pruning Script

Add this script to automate pruning:

```bash
#!/bin/bash
# scripts/prune-snapshots.sh
# Keep only the last N snapshots; remove older ones to reduce repo bloat.

KEEP_COUNT=${1:-3}
SNAPSHOT_DIR="apps/backend/drizzle/meta"

cd "$SNAPSHOT_DIR" || exit 1

# Get list of snapshots, sorted by number (descending)
snapshots=($(ls -1 *_snapshot.json | sed 's/_snapshot\.json//' | sort -n -r))

echo "Found ${#snapshots[@]} snapshots. Keeping the last $KEEP_COUNT."

for i in "${!snapshots[@]}"; do
  snapshot="${snapshots[$i]}_snapshot.json"
  
  if [ $i -lt "$KEEP_COUNT" ]; then
    echo "✅ Keeping: $snapshot"
  else
    echo "🗑️  Removing: $snapshot"
    git rm "$snapshot" 2>/dev/null || rm "$snapshot"
  fi
done

# Commit
git add -A
git commit -m "chore(db): prune old drizzle snapshots (keep last $KEEP_COUNT)" || echo "No changes to commit"
```

Usage:

```bash
bash scripts/prune-snapshots.sh 3
```

---

## Monitoring Repository Size

Check the size of your schema history:

```bash
# Size of all snapshots
du -sh apps/backend/drizzle/

# Size of .git directory
du -sh .git/

# Top 10 largest files in Git
git ls-files -z | xargs -0 du -S | sort -z -rn | head -10
```

If snapshots exceed 5% of your total `.git` size, consider pruning.

---

## Pre-Commit Snapshot Validation

To prevent stale snapshots, a pre-commit hook validates that `schema.ts` modifications are followed by snapshot regeneration. See `.husky/pre-commit` and `scripts/validate-drizzle-snapshot.mjs`.

If the hook fails:

```bash
npx drizzle-kit generate
git add apps/backend/drizzle/meta/
git commit
```

---

## Future Improvements

- **Incremental snapshots** — Drizzle could support delta snapshots instead of full snapshots.
- **Snapshot CDN** — Drizzle could fetch historical snapshots from a CDN during `npx drizzle-kit generate`.
- **pnpm or Yarn** — Alternative package managers handle monorepo constraints better and might allow tighter build-time snapshot control.
