# Coneeko Platform (`antd-platform`)

Multi-tenant restaurant SaaS: AI phone ordering, a counter-service POS, kitchen/receipt
printing, menus, orders, and billing — one npm-workspaces monorepo, one version number
across all apps (currently **v0.2.4**).

| App | Path | Stack |
|---|---|---|
| Backend API | `apps/backend` | NestJS 11, Drizzle ORM, Postgres, Redis/BullMQ, Socket.IO, MQTT |
| Dashboard | `apps/frontend` | Next.js 16 App Router, Ant Design v6 |
| Tablet POS | `apps/pos` | Expo / React Native Paper, offline-first SQLite, public API `/api/v2` |
| Shared types | `packages/shared-types` | TypeScript contracts shared by all three |

## Quick start

```bash
npm install
```

```bash
npm run dev --workspace antd-backend
```

```bash
npm run dev --workspace coneeko-frontend
```

```bash
npm run android --workspace antd-pos
```

Backend needs Postgres + Redis and a populated `.env` (see `apps/backend/.env.example` and
[DEPLOYMENT.md](DEPLOYMENT.md)). Bootstrap the schema and first admin with:

```bash
npm run db:migrate --workspace antd-backend && npm run provision --workspace antd-backend
```

## Common commands

| Task | Command |
|---|---|
| Backend tests | `npm run test --workspace antd-backend` |
| Backend e2e (live Postgres) | `npm run test:e2e --workspace antd-backend` |
| Frontend e2e | `npm run test:e2e --workspace coneeko-frontend` |
| Lint | `npm run lint --workspace antd-backend` / `--workspace coneeko-frontend` |
| New migration | `npm run db:generate --workspace antd-backend` |
| Cut a release | `npm run release` (see [CLAUDE.md](CLAUDE.md)) |

## Documentation map

| Doc | What it covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Monorepo conventions, versioning/release process, commit style |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Self-hosted deploy runbook + go-live checklist |
| [docs/ENGINEERING_REVIEW.md](docs/ENGINEERING_REVIEW.md) | Current findings (N1–N11), phased roadmap, epic backlog |
| [docs/POS_IMPLEMENTATION_PLAN.md](docs/POS_IMPLEMENTATION_PLAN.md) | Authoritative POS spec + P0–P4 roadmap |
| [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md) | 2026-07-13 production-readiness audit + remediation logs |
| [AUDIT_FIX_TRACKER.md](AUDIT_FIX_TRACKER.md) | 2026-07-04 audit checklist (51/51 closed) — historical |
| `apps/*/AGENTS.md`, `apps/*/CLAUDE.md` | Per-app engineering rules |

## Open work

Consolidated from the docs above and re-verified against `master` on 2026-07-23. Several
items the older docs list as open had already been fixed; those are marked *stale*.

### Fixed in this pass

- **N1 — orders could never reach `completed`.** The transition map wrote `completed` while
  `orders_status_check` allowed only `delivered`, so every `ready → completed` violated the
  constraint and 500'd. `completed` is now canonical (migration `0027` rewrites legacy
  `delivered` rows), and both state machines read one shared table in
  [order-status.ts](apps/backend/src/common/constants/order-status.ts). A regression test
  compares the constant set against the live CHECK constraint so they cannot drift again.
- **N3 — manager PIN hardening.** The PIN routes inherited a controller-wide `@SkipThrottle()`,
  so a 4-digit PIN had *no* rate limit. Added per-API-key throttling on those two routes, a
  per-user lockout (5 attempts → 15 min, migration `0028`), audit logging of every failure,
  and per-org PIN uniqueness at set time so an override names exactly one manager.
- **N7 — payments method CHECK.** Migration `0020` had expanded it to include
  `gift_card | store_credit | other`, but had never been applied — the database still enforced
  `cash | card` only. Applied.
- **N8 — currency.** `locations.currency` (ISO 4217, defaults `USD`, migration `0029`), settable
  via the location DTO. Money remains integer minor units; zero-decimal currencies (JPY, KRW)
  are still not formatted correctly.
- **N9 — backend lint is now a CI gate.** 193 errors → 0, mostly by typing the external
  Telnyx/DeepSeek responses ([telnyx.types.ts](apps/backend/src/telnyx/telnyx.types.ts)) instead
  of casting to `any`. CI gates backend lint; frontend lint stays informational.
- `json2csv` (abandoned on a `6.0.0-alpha` tag) replaced with the maintained `@json2csv/plainjs`.

### Uber Eats marketplace integration (order flow + menu push)

The aggregator's Uber Eats path was completed against Uber's approved test-store program:

- **Single Primary Webhook URL** at `POST /api/v1/webhooks/aggregator/ubereats` — resolves the
  tenant from the store id in the body (`meta.user_id`), verifies the `X-Uber-Signature` HMAC,
  dedupes, and returns Uber's required empty 200. (KitchenHub keeps its per-store URL.)
- **Store lifecycle**: `store.provisioned` / `store.deprovisioned` / `store.status.changed`
  drive the account's `status` / `is_online`.
- **Per-store auto-accept toggle** (`integration_accounts.auto_accept_orders`, default on):
  off leaves imported orders pending for manual accept/deny from the POS/dashboard within
  Uber's 11.5-min window. Flip via `PATCH /api/v1/aggregator/integration-accounts/:id`.
- **Real Uber menu schema** for `PUT /menus` (categories/items/modifier-groups, cents pricing,
  all-day availability) and order fetch via the webhook's version-pinned `resource_href`.
- Verified: 251 backend tests + a live HMAC/dedupe/lifecycle round-trip against the running app.
  Remaining before production: merchant OAuth onboarding (`GET /stores`, `POST /pos_data`), the
  dashboard UI, and wiring real store hours into menu `service_availability` (currently all-day).

### Still open

- **Secret rotation (C7 / N5)** — secrets predating git are unrotated. *Deliberately skipped.*
- **Drizzle tooling is broken:** `drizzle-kit` is hoisted to the root `node_modules` while
  `drizzle-orm` resolves only under `apps/backend/`, so `drizzle-kit migrate|push` fails. The
  `__drizzle_migrations` table is empty and schema drift accumulated silently (that is how N7
  stayed live). The **e2e suite cannot start** for the same reason. Migration `0026` is also
  missing from `meta/_journal.json` and is not idempotent.
- **Aggregator module partially audited** — `apps/backend/src/aggregator` (Uber Eats /
  KitchenHub adapters, HMAC webhooks, import queue). The Uber Eats order + menu path was
  reviewed and completed (see below); KitchenHub and the DoorDash/Grubhub stubs still want a
  pass.
- **Deployment go-live checklist** — 13 unchecked items at [DEPLOYMENT.md:497](DEPLOYMENT.md:497).
- **N4 — refunds are bookkeeping-only:** no processor integration, no drawer session.
- **N11 — no `staff`/cashier role.** The lowest real role is `manager`, which is why PIN-gating
  had to be invented in the first place.
- Deferred from the production audit: tenant-gate parameter-trust hardening (P8-003…010),
  request-id/error-path logging (P10-001/002/012), public-API pagination shape (P9-002/006),
  optimistic locking on concurrent order edits (P13-017), unit tests for 19 untested modules
  (P12-001).
- Cleanup: `orders.service.ts` is ~1.6k lines (split into orders/payments/refunds);
  `apps/frontend/.git.backup-pre-monorepo/` and `.kiro/` are dead weight.

### Feature roadmap (not started)

POS: KDS screen, drawer management + Z-reports, offline mode (P2/P3). Platform: online ordering
storefront + guest checkout, Stripe Terminal (deferred by decision), gift cards/store credit,
inventory, employees/shifts, loyalty, franchise rollups, delivery integrations.
Phasing and dependencies: [docs/ENGINEERING_REVIEW.md](docs/ENGINEERING_REVIEW.md) §5–6.

### Stale in the older docs

- **N2** (uncommitted WIP, `patch*.js`, `url.txt`) — tree is clean, files are gone.
- **N5** (no git remote, no CI) — both exist now; only secret rotation remains.
- **N6** (ticket-number race) — `nextTicketNumber` takes `pg_advisory_xact_lock`.
- **N9's other halves** — jest `rootDir` is `src` (no double-discovery) and the suite is green;
  only the lint debt was real.
- **N10** (PlanLimitGuard on agent/phone provisioning) — there is no tenant-facing provisioning
  endpoint to guard. Phone numbers and assistants are created only inside platform-admin
  provisioning, which plan limits should not gate; the guard's `voiceAgents`/`phoneNumbers`
  counters are unreachable until self-serve provisioning exists.
- Swagger title already reads correctly.
