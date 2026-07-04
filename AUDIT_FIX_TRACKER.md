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
| Critical    | 7        | 7     | 100%     |
| High        | 9        | 9     | 100%     |
| Medium      | 3        | 17    | 18%      |
| Low         | 0        | 10    | 0%       |
| Enhancement | 0        | 8     | 0%       |
| **Overall** | **19**   | **51**| **37%**  |

Backend items: 17/28 complete (61%) · Frontend items: 2/17 complete (12%) · Infra items: 1/6 complete (17%)

> **Critical: 7/7 done. High: 9/9 done.** All Critical and High audit findings are fixed,
> verified, and committed as small logical commits. Both apps build green. Backend tests
> improved 72→97 passing (22→8 failing; the 8 are pre-existing spec rot in heartbeat/stripe/
> telnyx — tracked under L8, untouched by these fixes and **unchanged in count = zero
> regressions across all work**). Backend lint 142→128 errors. M1 folded into C4; M8 into H1;
> M14 into H2.
>
> **H2 note:** implemented with a dependency-free HttpOnly-cookie refresh flow + token-reuse
> revocation; unit-verified and both builds pass, but the end-to-end cookie handshake was not
> exercised against a live browser+DB here — a login/refresh/logout smoke test is recommended
> before release (also applies to H6's global guard). **H8 note:** completed via a cached
> userId→org resolution rather than churning ~35 service signatures.

---

## Critical

### [x] C1 — Telnyx webhook accepts unauthenticated, unverified events

**Where:** `apps/backend/src/webhooks/webhooks.controller.ts` (`POST /webhooks/telnyx`)

**Impact**
- Anyone can forge `call.recording.saved` events (no Ed25519 signature verification).
- Idempotency is skippable by omitting `data.id` → unbounded queue jobs / Telnyx API calls.

**Fix**
- Verify the `telnyx-signature-ed25519` + `telnyx-timestamp` headers against the raw body
  using the Telnyx public key (`TELNYX_PUBLIC_KEY` env var).
- Reject events without an event ID.

**Effort:** 0.5 day
**Status:** Completed — commit `fix(webhooks): verify Telnyx Ed25519 signature…`
**Verification:** New `telnyx-signature.ts` (Ed25519 SPKI-wrap + 5-min replay window); controller
verifies raw body, fails closed in production when `TELNYX_PUBLIC_KEY` unset, rejects missing
event id. Unit tests (5) cover valid/tampered/replay/missing/wrong-key. Build ✅, lint clean on
touched files.

### [x] C2 — Recordings assigned to an arbitrary tenant (cross-tenant data leak)

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
**Status:** Completed — same commit as C1
**Verification:** `resolveTenantByNumber` resolves owner from `org_phone_numbers` then
`locations.phoneNumber`; job is skipped (logged) when unresolvable — the arbitrary
"first location" fallback is gone. Controller now forwards `toNumber`. Build ✅.

### [x] C3 — Cross-tenant write: menu item reorder not org-scoped

**Where:** `apps/backend/src/menus/menus.service.ts` (`reorderMenuItems`)

**Impact**
- Any authenticated user can change `sortOrder` of any tenant's menu items.

**Fix**
- Scope updates through `categories.organizationId` (same pattern as `reorderCategories`).

**Effort:** 1 hour
**Status:** Completed — commit `fix(menus): scope reorderMenuItems…`
**Verification:** Pre-flight join verifies every ID belongs to the caller's org (via category);
cross-tenant IDs now raise `NotFoundException`. Menus spec suite green. Build ✅.

### [x] C4 — IDOR: margin/usage report readable across tenants

**Where:** `apps/backend/src/billing/billing.service.ts` (`getMarginReport`)

**Impact**
- Usage aggregation filters only by caller-supplied `locationId`; any user can read any
  location's minutes/SMS/AI usage and computed margin.

**Fix**
- Verify the location belongs to the caller's org before aggregating; scope the usage query
  by `organizationId` as well.

**Effort:** 1 hour
**Status:** Completed — commit `fix(billing): enforce tenant isolation on margin report…`
**Verification:** Location ownership checked before any aggregation (else `NotFoundException`);
usage query scoped by `organizationId AND locationId`. Billing spec suite green. Build ✅.

### [x] C5 — Hardcoded JWT fallback secret / no env validation

**Where:** `apps/backend/src/auth/strategies/jwt.strategy.ts:16`

**Impact**
- If `JWT_SECRET` is unset, every token is forgeable with a string that is in the source.

**Fix**
- Remove the fallback; fail fast at bootstrap when `JWT_SECRET` / `JWT_REFRESH_SECRET` are
  missing (ConfigModule validation).

**Effort:** 2 hours
**Status:** Completed — commit `fix(auth): fail fast on missing JWT secrets…`
**Verification:** New `config/env.validation.ts` wired via `ConfigModule.forRoot({ validate })`
requires JWT secrets (>=16 chars, no placeholder text) + prod secrets; both hardcoded fallbacks
removed from `auth.module.ts` and `jwt.strategy.ts`. Dev `.env` passes (32/27-char secrets).
Build ✅.

### [x] C6 — Plan limits never enforced (all counts mocked to 0)

**Where:** `apps/backend/src/billing/guards/plan-limit.guard.ts`

**Impact**
- Free-tier orgs get unlimited agents/phone numbers/imports; silent revenue leak.

**Fix**
- Implement real current-usage counts (agents from `org_agents`, phone numbers from
  `org_phone_numbers`, imports from `usage_events` for the current month).

**Effort:** 2–3 days
**Status:** Completed — commit `fix(billing): enforce real plan limits…`
**Verification:** Guard computes real counts for all three resources (mocked `currentCount = 0`
removed); `@CheckLimit('websiteImports')` + `PlanLimitGuard` applied to `POST /menus/import`;
`website_import` usage event recorded on enqueue. Guard unit tests: below-limit passes, at-limit
→ 402. Build ✅. Note: guard is now wired on the import route; wiring it onto agent/phone-number
provisioning endpoints remains a follow-up (see New Concerns).

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

### [x] H1 — Orders page broken: API contract mismatch + wrong sort order

**Where:** `apps/frontend/src/app/orders/page.tsx:109`, `apps/backend/src/orders/orders.service.ts`

**Impact**
- Backend returns `{data,total,hasMore}`; frontend expects an array → page always renders
  empty. Server caps at 20 rows while the client paginates locally. Orders sort oldest-first.

**Fix**
- Consume the paginated envelope; wire AntD Table to server-side pagination; `desc(createdAt)`.

**Effort:** 0.5 day
**Status:** Completed — commits `fix(orders): …` + `fix(orders-ui): …`
**Verification:** Backend sorts `desc(createdAt)`, filters `isNull(deletedAt)`, adds a validated
status filter (M8). Frontend reads `{ data, total }` and drives the AntD Table from server
pagination (offset/limit). Backend orders spec green; both builds ✅; orders page lint clean.

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
**Status:** Completed — commits `feat(auth): …HttpOnly cookie + reuse detection` + `feat(auth-ui): …`
**Verification:** New dependency-free `refresh-cookie.ts` sets/reads/clears an `HttpOnly`,
`SameSite=Lax`, path-scoped refresh cookie (Secure in prod). `login`/`refresh`/`logout` and
`invitations/accept` use it; refresh reads cookie-first with a body fallback. Reuse detection:
a valid-signature refresh token whose hash is absent revokes the user's whole token family and
audit-logs it (unit-tested). Frontend `api.ts` refreshes with no body + `withCredentials`; the
four login-type pages no longer persist `refresh_token`. auth+invitations specs green (18);
both builds ✅.
**Residual risk:** the browser↔server cookie handshake wasn't exercised end-to-end here (no live
app). For a fully cross-site prod split (app.x / api.y as different registrable domains) the
cookie needs `SameSite=None; Secure` — noted in `refresh-cookie.ts`. Smoke-test before release.
**Note:** existing users with a localStorage-only session will be forced to re-login once (they
have no cookie yet) — expected for a security migration.

### [x] H3 — AI-order webhook: per-IP throttle drops real orders; idempotency marks completed before enqueue

**Where:** `apps/backend/src/webhooks/webhooks.controller.ts`

**Impact**
- All tenants' voice orders arrive from Telnyx's small egress IP pool → 429s on real orders.
- Idempotency row is written `completed` before `queue.add`; a queue failure loses the order
  forever (retry treated as duplicate).

**Fix**
- Throttle keyed on the org API key, not IP; insert idempotency row as `pending`, mark
  `completed` in the processor, delete the row if enqueue fails.

**Effort:** 1 day
**Status:** Completed — commit `fix(webhooks): per-API-key throttling…`
**Verification:** New `ApiKeyThrottlerGuard` keys the limit on `x-api-key` (60/min per org);
idempotency row inserted `pending` and enqueue wrapped in try/catch that deletes the row on
failure. Telnyx endpoint keeps IP throttle (120/min). webhooks.controller spec green; build ✅.

### [x] H4 — API keys never expire; suspended orgs keep API access

**Where:** `apps/backend/src/public-api/guards/api-key-auth.guard.ts`

**Impact**
- `expiresAt` exists in schema but is never checked; org status is ignored on the public API.

**Fix**
- Reject expired keys; reject keys of suspended/archived orgs.

**Effort:** 2 hours
**Status:** Completed — commit `fix(public-api): reject expired keys…`
**Verification:** `ApiKeyAuthGuard` now checks `apiKeys.expiresAt` and the owning org's status;
expired keys and suspended/archived orgs are rejected with 401. Build ✅.

### [x] H5 — Order creation: unscoped menu-item lookup; `locationId` never persisted

**Where:** `apps/backend/src/orders/orders.service.ts` (`createOrderForOrg`)

**Impact**
- Orders can reference other tenants' (or deleted/unavailable) menu items.
- Orders have no `locationId` → excluded from location-filtered lists/KPIs; usage recording
  falls back to `locationId = orgId`, violating the FK and silently failing → under-billing.

**Fix**
- Scope item lookup by org + `deletedAt` + `isAvailable`; resolve and persist `locationId`
  (single-location org fallback; webhook location hint when available).

**Effort:** 1 day
**Status:** Completed — commit `fix(orders): org-scope menu items…`
**Verification:** Item lookup joins category→org and filters `deletedAt`/`isAvailable`;
`resolveOrderLocation` sets `orders.locationId` (hint → item location → org's single location);
usage recorded only when a location resolves (no more FK-violating `locationId || orgId`).
Orders spec green; build ✅.

### [x] H6 — No global guards: security is opt-in per controller

**Where:** `apps/backend/src/app.module.ts`

**Impact**
- One forgotten `@UseGuards` ships an open endpoint; ThrottlerModule is configured but the
  guard applies to only 4 controllers.

**Fix**
- Register `JwtAuthGuard` + `RolesGuard` as `APP_GUARD`s; mark public endpoints `@Public()`;
  apply throttling deliberately (auth/webhooks strict, sane default elsewhere).

**Effort:** 1 day
**Status:** Completed — commit `feat(auth): global JWT + roles guards…`
**Verification:** `GlobalJwtAuthGuard` + `RolesGuard` registered as `APP_GUARD` (JWT first).
Guard honors `@Public()` and allow-lists Prometheus `/metrics` (verified library mounts it).
Public controllers marked `@Public`: app root, Stripe/Telnyx/AI webhooks, API-key public API v2;
confirmed all auth flows (login/refresh/logout/reset/verify) are `@Public`. New guard spec (3)
covers metrics allowlist, `@Public` bypass, passport delegation. Full suite: no new failures
(same 3 pre-existing suites). Build ✅.
**Residual risk:** not runtime-verified against a booted app (no DB/Redis here); the DI graph
compiles and guard logic is unit-tested, but a smoke test of one protected + one public route
against a live server is recommended before release.

### [x] H7 — Cache correctness: global clears, blocking KEYS scans, incomplete cache keys

**Where:** `apps/backend/src/menus/menus.service.ts`

**Impact**
- `clearMenuCache` flushes every tenant's cache; invalidation uses Redis `KEYS` (O(N),
  blocks the shared Redis that also backs BullMQ); cache key omits `showDeleted` so admin
  and customer views poison each other for an hour.

**Fix**
- Per-org version-stamped cache keys (`menu:{orgId}:v{n}:…`); include all query params in
  the key; org-scoped clear.

**Effort:** 1 day
**Status:** Completed — commit `fix(menus): version-stamped menu cache keys…`
**Verification:** `clearMenuCache` is org-scoped; invalidation bumps a per-org version stamp
(O(1)) instead of a blocking `KEYS` scan; cache key includes version + `showDeleted` scope.
Removed the `any`-cast into ioredis (−1 eslint-disable). Menus spec updated + green; build ✅.

### [x] H8 — Redundant per-request DB lookups for org resolution

**Where:** `apps/backend/src/billing/billing.service.ts` (`getRequiredOrg`) + callers

**Impact**
- JwtStrategy already fetches the user per request; services re-fetch the same row 1–3 more
  times per request (latency + cost on serverless Postgres).

**Fix**
- Pass the authenticated user payload (which carries a fresh `organizationId`) from
  controllers into services instead of re-querying by `userId`.

**Effort:** 2 days
**Status:** Completed — commits `perf(billing): use JWT-resolved org in PlanLimitGuard` +
`perf(billing): cache userId→org resolution`
**Verification:** `getRequiredOrg` short-circuits on the JWT-carried org (object overload; used
by PlanLimitGuard), and for the string-userId path used across ~35 service call sites it now
caches the resolution for 60s and selects only `organizationId`. This removes the repeated
per-request users-table queries universally, in one file, without churning every service
signature. Billing specs green; build ✅.
**Trade-off:** an org reassignment is visible after ≤60s (acceptable — the JWT itself pins org
for 15 min). A future refactor could still pass the user object through service signatures to
avoid even the cache read.

### [x] H9 — Platform-admin org impersonation is unvalidated and unaudited

**Where:** `apps/backend/src/auth/strategies/jwt.strategy.ts:36`

**Impact**
- `req.body.orgId`/`req.query.orgId` silently rewrite tenant context inside authentication;
  no UUID validation (query can be an array), no audit trail of which admin viewed which org.

**Fix**
- Accept override from query only; validate UUID format; log the tenant switch.

**Effort:** 1 day
**Status:** Completed — commit `fix(auth): validate and audit platform-admin tenant override`
**Verification:** `JwtStrategy` accepts the orgId override from the query string only, requires a
well-formed UUID, and logs when an admin operates outside their home tenant. The body-smuggling
path is removed. Build ✅.

---

## Medium

### [x] M1 — `console.log` with user object on nearly every request
**Where:** `billing.service.ts:32` · **Impact:** PII in stdout, log spam. · **Fix:** removed. · **Effort:** 5 min · **Status:** Completed (folded into C4 commit)

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

### [x] M8 — Orders list: no `deletedAt` filter, no server-side status filter/search
**Where:** `orders.service.ts` (`getOrders`) · **Fix:** added `isNull(deletedAt)` + validated `status` filter to GetOrdersDto (folded into H1). Full-text search still TODO. · **Effort:** 1 day · **Status:** Completed (search deferred)

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

### [x] M14 — Logout doesn't clear tenant context (`selectedOrgId`/`selectedLocationId`)
**Where:** `DashboardLayout.tsx` (logout handler) · **Impact:** next login on shared terminal inherits previous tenant; stale `orgId` sent by API interceptor. · **Effort:** 1 h · **Status:** Completed (folded into H2 frontend commit) — logout now clears `selectedOrgId`/`selectedLocationId`.

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
| 2026-07-04 | C1–C6 + M1 (Critical done) | clean on touched files | BE ✅ | 94 pass / 8 fail | 8 remaining = pre-existing heartbeat/stripe/telnyx spec rot (L8); +11 new tests added; no regressions |
| 2026-07-04 | H1,H3,H4,H5,H6,H7,H8(partial),H9,M8 | clean on touched files; BE 142→128e; FE 45e (unchanged) | BE ✅ FE ✅ | 97 pass / 8 fail | Same 3 pre-existing suites fail — zero regressions from High work; +6 new tests (telnyx-sig, plan-limit, global-guard) |
| 2026-07-04 | H2, H8 (complete), M14 — **all High done** | clean on touched files | BE ✅ FE ✅ | 97 pass / 8 fail | HttpOnly-cookie refresh + reuse detection; org-resolution cache; same 3 pre-existing suites — zero regressions |

## New Architecture Concerns (discovered during implementation)

1. **Test/build duplication.** Jest matches specs in both `src/` and a stale compiled tree, so
   every suite is reported twice (e.g. `src/printers/…` and `printers/…`). A leftover build
   output dir is being picked up — jest `roots`/`testPathIgnorePatterns` should exclude it, and
   `dist/` should be cleaned. Inflates counts and slows CI.
2. **Pre-existing spec rot (L8).** `heartbeat`, `stripe-webhook`, `telnyx` specs fail on drift
   (unmocked `onConflictDoNothing`, an outdated asserted URL, missing DI). Not caused by these
   fixes; they must be repaired before tests can gate CI meaningfully.
3. **`getRequiredOrg` still re-queries per call (H8).** The PlanLimitGuard resolves org via
   `getRequiredOrg(user.id)` even though the JWT payload already carries `organizationId` — the
   same redundant-lookup pattern flagged in H8, now in one more place.
4. **Plan-limit wiring is partial.** C6 makes the guard *correct*, but it's only applied to the
   website-import route. Agent and phone-number provisioning endpoints still need the guard for
   full enforcement (the counts are ready; only the decorators are missing).
5. **Backend lint debt (142 errors).** Concentrated in `no-unsafe-*` on `any` around Telnyx/
   Gemini response handling (`syncMenuToAI`, webhook processor, ai-extractor). A typed-response
   pass (M5 area) would clear most of it and is a prerequisite for a zero-warning CI gate.
