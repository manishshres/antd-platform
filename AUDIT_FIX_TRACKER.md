# Audit Fix Tracker — Call Center AI SaaS Platform

Source: full-stack audit (2026-07-04). This file is the implementation checklist and progress
tracker for every audit finding. Update the status marker and the Verification block of each
item as work proceeds.

**Status legend:** `[ ]` Not Started · `[~]` In Progress · `[x]` Completed · `[!]` Blocked

**Fix order policy:** Critical security → data integrity → runtime bugs → performance →
architecture → UX → cleanup. One category is completed before the next begins.
Every completed item must pass: `npm run lint`, `npm run build`, `npm run test` (backend),
and a frontend `npm run build` — results are documented per item.

---

## Progress Dashboard

| Category    | Complete | Total | Progress |
|-------------|----------|-------|----------|
| Critical    | 0        | 7     | 0%       |
| High        | 0        | 9     | 0%       |
| Medium      | 0        | 17    | 0%       |
| Low         | 0        | 10    | 0%       |
| Enhancement | 0        | 8     | 0%       |
| **Overall** | **0**    | **51**| **0%**   |

Backend items: 0/28 complete (0%) · Frontend items: 0/17 complete (0%) · Infra items: 0/6 complete (0%)

---

## Critical

### [ ] C1 — Telnyx webhook accepts unauthenticated, unverified events

**Where:** `apps/backend/src/webhooks/webhooks.controller.ts` (`POST /webhooks/telnyx`)

**Impact**
- Anyone can forge `call.recording.saved` events (no Ed25519 signature verification).
- Idempotency is skippable by omitting `data.id` → unbounded queue jobs / Telnyx API calls.

**Fix**
- Verify the `telnyx-signature-ed25519` + `telnyx-timestamp` headers against the raw body
  using the Telnyx public key (`TELNYX_PUBLIC_KEY` env var).
- Reject events without an event ID.

**Effort:** 0.5 day
**Status:** Not Started
**Verification:** —

### [ ] C2 — Recordings assigned to an arbitrary tenant (cross-tenant data leak)

**Where:** `apps/backend/src/recordings/recordings.processor.ts:49`

**Impact**
- When org/location are missing (always, via the webhook path), the processor attaches the
  recording — audio, transcript, phone numbers — to the *first location in the database*.
- Combined with C1: unauthenticated cross-tenant data injection.

**Fix**
- Resolve the owning location from the call's `to` number via `org_phone_numbers` /
  `locations.phoneNumber`; drop the job with a warning if unresolvable. Never fall back to
  "first location".

**Effort:** 1 day
**Status:** Not Started
**Verification:** —

### [ ] C3 — Cross-tenant write: menu item reorder not org-scoped

**Where:** `apps/backend/src/menus/menus.service.ts` (`reorderMenuItems`)

**Impact**
- Any authenticated user can change `sortOrder` of any tenant's menu items.

**Fix**
- Scope updates through `categories.organizationId` (same pattern as `reorderCategories`).

**Effort:** 1 hour
**Status:** Not Started
**Verification:** —

### [ ] C4 — IDOR: margin/usage report readable across tenants

**Where:** `apps/backend/src/billing/billing.service.ts` (`getMarginReport`)

**Impact**
- Usage aggregation filters only by caller-supplied `locationId`; any user can read any
  location's minutes/SMS/AI usage and computed margin.

**Fix**
- Verify the location belongs to the caller's org before aggregating; scope the usage query
  by `organizationId` as well.

**Effort:** 1 hour
**Status:** Not Started
**Verification:** —

### [ ] C5 — Hardcoded JWT fallback secret / no env validation

**Where:** `apps/backend/src/auth/strategies/jwt.strategy.ts:16`

**Impact**
- If `JWT_SECRET` is unset, every token is forgeable with a string that is in the source.

**Fix**
- Remove the fallback; fail fast at bootstrap when `JWT_SECRET` / `JWT_REFRESH_SECRET` are
  missing (ConfigModule validation).

**Effort:** 2 hours
**Status:** Not Started
**Verification:** —

### [ ] C6 — Plan limits never enforced (all counts mocked to 0)

**Where:** `apps/backend/src/billing/guards/plan-limit.guard.ts`

**Impact**
- Free-tier orgs get unlimited agents/phone numbers/imports; silent revenue leak.

**Fix**
- Implement real current-usage counts (agents from `org_agents`, phone numbers from
  `org_phone_numbers`, imports from `usage_events` for the current month).

**Effort:** 2–3 days
**Status:** Not Started
**Verification:** —

### [x] C7 — No version control / CI / secrets hygiene

**Where:** repository root

**Impact**
- No git history, secrets (`.env`) and live DB data (`postgres_data/`) inside the package,
  no reproducible deploy, disk failure = total loss.

**Fix**
- `git init` + `.gitignore` (env, data, builds); baseline commit; nested stray `.git` dirs
  resolved (frontend history preserved at `apps/frontend/.git.backup-pre-monorepo`).
- Follow-ups (separate items, still open): **rotate all secrets currently in `.env`** (they
  existed on disk pre-git, treat as compromised), add a git remote + CI pipeline + Dockerfiles.

**Effort:** 1 day
**Status:** Completed (core) — secret rotation + CI/CD deferred to owner (needs infra creds)
**Verification:** `git ls-files` confirms only `.env.example` tracked; `.env`, `postgres_data/`,
`mosquitto.passwd`, `node_modules/`, build dirs all excluded. Builds unaffected.

---

## High

### [ ] H1 — Orders page broken: API contract mismatch + wrong sort order

**Where:** `apps/frontend/src/app/orders/page.tsx:109`, `apps/backend/src/orders/orders.service.ts`

**Impact**
- Backend returns `{data,total,hasMore}`; frontend expects an array → page always renders
  empty. Server caps at 20 rows while the client paginates locally. Orders sort oldest-first.

**Fix**
- Consume the paginated envelope; wire AntD Table to server-side pagination; `desc(createdAt)`.

**Effort:** 0.5 day
**Status:** Not Started
**Verification:** —

### [ ] H2 — Refresh/access tokens in localStorage; no reuse detection

**Where:** `apps/frontend/src/lib/api.ts`, `apps/backend/src/auth/*`

**Impact**
- Any XSS exfiltrates a 7–30-day refresh token → full account takeover.
- A stolen already-rotated refresh token is not detected (no family revocation).

**Fix**
- Deliver refresh token as HTTP-only `SameSite=Lax` cookie; keep access token out of
  localStorage where feasible; on presentation of a valid-signature but unknown refresh
  token, revoke all of the user's refresh tokens.

**Effort:** 2–3 days
**Status:** Not Started
**Verification:** —

### [ ] H3 — AI-order webhook: per-IP throttle drops real orders; idempotency marks completed before enqueue

**Where:** `apps/backend/src/webhooks/webhooks.controller.ts`

**Impact**
- All tenants' voice orders arrive from Telnyx's small egress IP pool → 429s on real orders.
- Idempotency row is written `completed` before `queue.add`; a queue failure loses the order
  forever (retry treated as duplicate).

**Fix**
- Throttle keyed on the org API key, not IP; insert idempotency row as `pending`, mark
  `completed` in the processor, delete the row if enqueue fails.

**Effort:** 1 day
**Status:** Not Started
**Verification:** —

### [ ] H4 — API keys never expire; suspended orgs keep API access

**Where:** `apps/backend/src/public-api/guards/api-key-auth.guard.ts`

**Impact**
- `expiresAt` exists in schema but is never checked; org status is ignored on the public API.

**Fix**
- Reject expired keys; reject keys of suspended/archived orgs.

**Effort:** 2 hours
**Status:** Not Started
**Verification:** —

### [ ] H5 — Order creation: unscoped menu-item lookup; `locationId` never persisted

**Where:** `apps/backend/src/orders/orders.service.ts` (`createOrderForOrg`)

**Impact**
- Orders can reference other tenants' (or deleted/unavailable) menu items.
- Orders have no `locationId` → excluded from location-filtered lists/KPIs; usage recording
  falls back to `locationId = orgId`, violating the FK and silently failing → under-billing.

**Fix**
- Scope item lookup by org + `deletedAt` + `isAvailable`; resolve and persist `locationId`
  (single-location org fallback; webhook location hint when available).

**Effort:** 1 day
**Status:** Not Started
**Verification:** —

### [ ] H6 — No global guards: security is opt-in per controller

**Where:** `apps/backend/src/app.module.ts`

**Impact**
- One forgotten `@UseGuards` ships an open endpoint; ThrottlerModule is configured but the
  guard applies to only 4 controllers.

**Fix**
- Register `JwtAuthGuard` + `RolesGuard` as `APP_GUARD`s; mark public endpoints `@Public()`;
  apply throttling deliberately (auth/webhooks strict, sane default elsewhere).

**Effort:** 1 day
**Status:** Not Started
**Verification:** —

### [ ] H7 — Cache correctness: global clears, blocking KEYS scans, incomplete cache keys

**Where:** `apps/backend/src/menus/menus.service.ts`

**Impact**
- `clearMenuCache` flushes every tenant's cache; invalidation uses Redis `KEYS` (O(N),
  blocks the shared Redis that also backs BullMQ); cache key omits `showDeleted` so admin
  and customer views poison each other for an hour.

**Fix**
- Per-org version-stamped cache keys (`menu:{orgId}:v{n}:…`); include all query params in
  the key; org-scoped clear.

**Effort:** 1 day
**Status:** Not Started
**Verification:** —

### [ ] H8 — Redundant per-request DB lookups for org resolution

**Where:** `apps/backend/src/billing/billing.service.ts` (`getRequiredOrg`) + callers

**Impact**
- JwtStrategy already fetches the user per request; services re-fetch the same row 1–3 more
  times per request (latency + cost on serverless Postgres).

**Fix**
- Pass the authenticated user payload (which carries a fresh `organizationId`) from
  controllers into services instead of re-querying by `userId`.

**Effort:** 2 days
**Status:** Not Started
**Verification:** —

### [ ] H9 — Platform-admin org impersonation is unvalidated and unaudited

**Where:** `apps/backend/src/auth/strategies/jwt.strategy.ts:36`

**Impact**
- `req.body.orgId`/`req.query.orgId` silently rewrite tenant context inside authentication;
  no UUID validation (query can be an array), no audit trail of which admin viewed which org.

**Fix**
- Accept override from query only; validate UUID format; log the tenant switch.

**Effort:** 1 day
**Status:** Not Started
**Verification:** —

---

## Medium

### [ ] M1 — `console.log` with user object on nearly every request
**Where:** `billing.service.ts:32` · **Impact:** PII in stdout, log spam. · **Fix:** remove (use Logger if needed). · **Effort:** 5 min · **Status:** Not Started

### [ ] M2 — Refresh rotation ignores `rememberMe` TTL
**Where:** `auth.service.ts` (`refresh`) · **Impact:** 30-day sessions shrink to 7 days after first refresh. · **Fix:** persist chosen TTL with the token family and reuse on rotation. · **Effort:** 1 h · **Status:** Not Started

### [ ] M3 — Account-lockout counter race (read-modify-write)
**Where:** `auth.service.ts` (`validateUser`) · **Impact:** parallel attempts bypass lockout increments. · **Fix:** atomic `SET failed_login_attempts = failed_login_attempts + 1`. · **Effort:** 2 h · **Status:** Not Started

### [ ] M4 — Role model sprawl; invitation default role is `sysadmin`
**Where:** guards, DTOs, schema, sidebar · **Impact:** four inconsistent role taxonomies; risky invite default. · **Fix:** single role enum + migration; explicit invite role required. · **Effort:** 2 days · **Status:** Not Started

### [ ] M5 — `syncMenuToAI`: shared Telnyx bucket, global embed, raw `process.env`
**Where:** `menus.service.ts:852` · **Impact:** cross-tenant knowledge-base contamination risk. · **Fix:** per-org object prefix/bucket; ConfigService; typed responses. · **Effort:** 2 days · **Status:** Not Started

### [ ] M6 — Dashboard metrics use server timezone; JS-side grouping
**Where:** `analytics.service.ts` (`getDashboardMetrics`) · **Impact:** "today" is wrong for locations in other timezones. · **Fix:** `date_trunc AT TIME ZONE location.timezone` + SQL `GROUP BY`. · **Effort:** 1 day · **Status:** Not Started

### [ ] M7 — `deleteCategory` leaves child items live
**Where:** `menus.service.ts` · **Impact:** orphaned active items under soft-deleted category. · **Fix:** cascade soft-delete/restore of items in the same transaction. · **Effort:** 2 h · **Status:** Not Started

### [ ] M8 — Orders list: no `deletedAt` filter, no server-side status filter/search
**Where:** `orders.service.ts` (`getOrders`) · **Fix:** add `isNull(deletedAt)`, status/search params to DTO. · **Effort:** 1 day · **Status:** Not Started

### [ ] M9 — WS gateway CORS `origin: '*'`; three overlapping realtime channels
**Where:** `events.gateway.ts` · **Fix:** restrict origin to FRONTEND_URL; consolidate on one realtime mechanism. · **Effort:** 0.5 day · **Status:** Not Started

### [ ] M10 — Status/role/type columns are free-text varchar (no CHECK/enums)
**Where:** `schema.ts` · **Fix:** pg enums or CHECK constraints + migration. · **Effort:** 1–2 days · **Status:** Not Started

### [ ] M11 — Missing composite indexes; `webhook_events` grows forever
**Where:** `schema.ts` · **Fix:** `orders(org, created_at desc)`, `usage_events(org, event_type, created_at)`, `recordings(org, created_at)`, `audit_logs(org, created_at)`; cron cleanup for `webhook_events`. · **Effort:** 0.5 day · **Status:** Not Started

### [ ] M12 — No Next.js middleware auth (client-only guard, protected-page flash)
**Where:** `apps/frontend` (no `middleware.ts`) · **Fix:** cookie-based middleware redirect for unauthenticated users (pairs with H2). · **Effort:** 1 day · **Status:** Not Started

### [ ] M13 — Sidebar never highlights top-level items (`/calls`, `/dashboard`)
**Where:** `DashboardLayout.tsx:124` · **Fix:** match top-level keys too, pick longest prefix match. · **Effort:** 1 h · **Status:** Not Started

### [ ] M14 — Logout doesn't clear tenant context (`selectedOrgId`/`selectedLocationId`)
**Where:** `DashboardLayout.tsx` (logout handler) · **Impact:** next login on shared terminal inherits previous tenant; stale `orgId` sent by API interceptor. · **Effort:** 1 h · **Status:** Not Started

### [ ] M15 — `LocationContext` parses JWT once at mount (stale role after login)
**Where:** `LocationContext.tsx:54` · **Fix:** derive role reactively (context refresh on auth change). · **Effort:** 0.5 day · **Status:** Not Started

### [ ] M16 — Dark-mode FOUC; theme unavailable during SSR
**Where:** `DashboardLayout.tsx:411` · **Fix:** persist theme in cookie / inline script before hydration. · **Effort:** 0.5 day · **Status:** Not Started

### [ ] M17 — Production rewrite hardcodes `localhost:4000`
**Where:** `apps/frontend/next.config.ts` · **Fix:** derive destination from env; fail loudly if unset in prod. · **Effort:** 1 h · **Status:** Not Started

---

## Low

### [ ] L1 — Dead `register()` kept alive with six eslint-disables — delete (`auth.service.ts:55`) · **Status:** Not Started
### [ ] L2 — Corrupted doc comment with stray import line (`menus.service.ts:484`) · **Status:** Not Started
### [ ] L3 — Hardcoded `TEST_PRINTER_ID` in orders page (`orders/page.tsx:81`) · **Status:** Not Started
### [ ] L4 — `formatPrice`/`formatPhone`/status maps duplicated across pages → `src/lib/format.ts` · **Status:** Not Started
### [ ] L5 — `console.log` in `useSocket`; socket never re-auths after token refresh · **Status:** Not Started
### [ ] L6 — `any` types in layout/context (`rawItems: any[]`, `aiSettings?: any`) · **Status:** Not Started
### [ ] L7 — Hardcoded hex colors in dashboard quick actions & sidebar (violates token rule) · **Status:** Not Started
### [ ] L8 — Zero controller/e2e tests on webhooks, recordings processor, guards · **Status:** Not Started
### [ ] L9 — Stray scripts in backend root (`test-telnyx-*.js`, `generate.exp`) · **Status:** Not Started
### [ ] L10 — Frontend package still named `antd-demo` · **Status:** Not Started

---

## Enhancement (post-fix roadmap, from audit Parts 3–4)

### [ ] E1 — Header org/location switcher (move out of profile dropdown) + shared `PageHeader` · **Status:** Not Started
### [ ] E2 — Standardized table toolbar (search/filters/export), sticky headers, server pagination everywhere · **Status:** Not Started
### [ ] E3 — Settings page → Tabs (General / AI / Hours / Menu Sync / Danger Zone) with dirty-state warning · **Status:** Not Started
### [ ] E4 — One shared skeleton / empty-state-with-CTA / error-result language across pages · **Status:** Not Started
### [ ] E5 — Global search / command palette (⌘K) · **Status:** Not Started
### [ ] E6 — Notifications center fed by existing socket events (order failures, printer offline) · **Status:** Not Started
### [ ] E7 — CSV export on orders/calls/usage; saved table views · **Status:** Not Started
### [ ] E8 — Onboarding checklist + `Tour` (provision → forward → import menu → test order) · **Status:** Not Started

---

## Verification Baseline (before any fixes — 2026-07-04)

Recorded so regressions can be distinguished from pre-existing breakage.

- **Backend build:** ✅ passes (`nest build`)
- **Frontend build:** ✅ passes (`next build`)
- **Backend tests:** ❌ 22 failing / 72 passing (94 total, 5 suites red). Cause = stale spec
  DI: `billing`/`menus` specs miss the `TelnyxService` provider added later; `stripe`/`menus`
  specs don't mock `onConflictDoNothing`; `telnyx` spec asserts an old URL; `heartbeat` spec DI.
  These are **pre-existing** and unrelated to audit fixes. Spec rot tracked under L8; specs for
  services touched by a fix are repaired as part of that fix.
- **Backend lint:** ❌ 142 errors / 4 warnings (pre-existing, mostly `no-unsafe-*` on `any`).
- **Frontend lint:** ❌ 45 errors / 79 warnings (pre-existing; incl. setState-in-effect,
  unused vars, exhaustive-deps).

Regression rule: a fix must not increase failing tests or lint errors in the files it touches,
and both builds must stay green.

## Verification Log

| Date | Item | Lint | Build | Tests | Notes |
|------|------|------|-------|-------|-------|
| 2026-07-04 | Baseline | BE 142e / FE 45e | BE ✅ FE ✅ | 72 pass / 22 fail | Pre-existing failures documented above |
