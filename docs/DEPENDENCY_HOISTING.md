# Dependency Hoisting: Drizzle ORM & PostgreSQL Client

## The Problem

This monorepo has `drizzle-kit`, `drizzle-orm`, and `pg` declared in **both** the root `package.json` and `apps/backend/package.json`. This appears to be duplication, but it's a required workaround for npm's dependency resolution algorithm.

### Why It's Necessary

1. **npm hoists `drizzle-kit` to root** — because it's a dev tool used across the monorepo, npm's hoisting algorithm places it at the root level.

2. **drizzle-kit resolves modules relative to itself** — when you run `npx drizzle-kit generate`, it tries to load `drizzle-orm/version` relative to drizzle-kit's own location (the root).

3. **If `drizzle-orm` is only in `apps/backend`** — drizzle-kit can't find it at the root, and fails with a misleading error: *"Please install latest version of drizzle-orm"*

4. **`pg` is a peer dependency** — `drizzle-orm/node-postgres` requires `pg` as a peer wherever drizzle-orm ends up, so it must also be hoisted.

### The Solution

```json
// root/package.json
{
  "devDependencies": {
    "drizzle-orm": "^0.45.2",
    "pg": "^8.22.0"
  }
}

// apps/backend/package.json
{
  "devDependencies": {
    "drizzle-orm": "^0.45.2",
    "pg": "^8.22.0"
  }
}
```

Both must exist with **identical version ranges** for this to work correctly.

---

## Maintenance Requirements

### Critical: Keep Versions In Sync

When you update `drizzle-orm` or `pg`, you must update **both** locations:

```bash
# ✅ CORRECT: Update both at the same time
npm install --workspace=@platform/backend drizzle-orm@latest pg@latest
npm install --save-dev drizzle-orm@latest pg@latest

# ❌ WRONG: Only updating backend
npm install --workspace=@platform/backend drizzle-orm@latest  # ← don't do this alone

# ❌ WRONG: Only updating root
npm install --save-dev drizzle-orm@latest  # ← don't do this alone
```

**Why?** If versions diverge:

```json
// root has 0.46.0
{
  "devDependencies": {
    "drizzle-orm": "^0.46.0"
  }
}

// backend has 0.45.2
{
  "devDependencies": {
    "drizzle-orm": "^0.45.2"
  }
}
```

Then `npx drizzle-kit generate` may use the root's 0.46.0, but your backend code was built against 0.45.2 — leading to silent type mismatches or runtime errors.

### Script to Check Versions

Run this to verify they're in sync:

```bash
root_version=$(grep -A1 '"drizzle-orm"' package.json | grep -o '\^[0-9\.]*')
backend_version=$(grep -A1 '"drizzle-orm"' apps/backend/package.json | grep -o '\^[0-9\.]*')

if [ "$root_version" != "$backend_version" ]; then
  echo "❌ Version mismatch:"
  echo "  root: $root_version"
  echo "  backend: $backend_version"
  exit 1
else
  echo "✅ Versions match: $root_version"
fi
```

---

## Side Effects

Since `drizzle-orm` and `pg` are installed at the root, they're technically available to **all workspace packages** (frontend, POS, etc.), even though they should only be used by the backend.

### This is Not Ideal

- **Encapsulation violation**: Non-backend apps can accidentally import from `pg` or drizzle-orm.
- **Bundle bloat**: If any app mistakenly includes these in production bundles, they add unnecessary size (though `pg` is rarely bundled for web).

### Why We Haven't Fixed It

A proper fix would require:

1. **Upgrading npm workspaces** to support scoped hoisting (npm 10+ has some improvements, but they're incomplete).
2. **Switching to pnpm**, which has better workspace isolation.
3. **Refactoring the drizzle-kit build process** to resolve modules differently.

None of these are quick changes, so we live with the hoisting for now.

### Mitigation

- Lint rules can warn if non-backend packages import from `pg` or drizzle-orm.
- Documentation (this file) makes the trade-off explicit.
- Code review catches accidental imports.

---

## When You Encounter the "Please Install Latest Version" Error

If `npx drizzle-kit generate` fails with:

> **Error: Please install latest version of drizzle-orm**

Check:

1. ✅ Is `drizzle-orm` in `root/package.json` devDependencies?
2. ✅ Is `pg` in `root/package.json` devDependencies?
3. ✅ Do the version ranges match between root and `apps/backend`?
4. ✅ Did you run `npm install` in the root to sync `package-lock.json`?

Then try:

```bash
npm install
npx drizzle-kit generate
```

If it still fails, run the diagnostic:

```bash
node -e "console.log(require.resolve('drizzle-orm/version'))"
```

If that path doesn't exist, drizzle-kit can't find your drizzle-orm installation — confirm it's in root/package.json and reinstall.

---

## Future Improvements

- Monitor npm and pnpm for better workspace dependency isolation.
- Consider migration to pnpm when the team is ready.
- Add lint rules to prevent non-backend packages from importing drizzle-orm or pg.
- Automate version-sync checking in CI.
