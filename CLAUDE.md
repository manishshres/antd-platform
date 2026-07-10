# CLAUDE.md — antd-platform (monorepo root)

npm-workspaces monorepo for the Coneeko restaurant SaaS platform.

- `apps/backend` — NestJS 11 API (see its `CLAUDE.md` / `AGENTS.md`)
- `apps/frontend` — Next.js 16 App Router UI (see its `CLAUDE.md` / `AGENTS.md`)

## Versioning & Releases

The whole platform ships under **one version number**, kept in lockstep across
the root, backend, and frontend `package.json` files.

- Backend serves its version at `GET /api/v1/health` and `GET /api/v1/health/version`
  (read at runtime from `package.json` via `src/common/version.ts`).
- Frontend bakes `NEXT_PUBLIC_APP_VERSION` at build time (`next.config.ts`)
  and shows it in the dashboard footer.

**To cut a release** (from the repo root, after feature work is committed):

```bash
npm run release            # patch bump: 0.1.0 -> 0.1.1
npm run release minor      # 0.1.0 -> 0.2.0
npm run release major      # 0.1.0 -> 1.0.0
npm run release 1.2.3      # explicit version
npm run release -- --dry-run   # preview without changing anything
```

The script (`scripts/release.mjs`) writes the new version to all three
`package.json` files, refreshes the root lockfile, then creates a
`release: vX.Y.Z` commit containing only those files and a `vX.Y.Z` git tag.
It refuses to reuse an existing tag. Push with `git push && git push --tags`.

Do not bump versions by hand or with bare `npm version` in a single app —
that drifts the apps apart.

## Commit style

Plain, conventional messages (`fix(pos): …`, `feat(orders): …`, `release: v0.1.1`).
No AI-attribution trailers.
