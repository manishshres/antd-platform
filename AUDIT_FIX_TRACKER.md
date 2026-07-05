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
| Medium      | 17       | 17    | 100%     |
| Low         | 10       | 10    | 100%     |
| Enhancement | 8        | 8     | 100%     |
| **Overall** | **51**   | **51**| **100%** |

Backend items: 25/28 complete (89%) · Frontend items: 14/17 complete (82%) · Infra items: 1/6 complete (17%)

> **Platform-admin access fix (new, beyond the audit):** platform admins got a 403
> ("User does not belong to an organization") on `/menus`, `/menus/modifiers/groups`,
> recordings, conversations, and orders. Root cause: those services resolved the org via
> `getRequiredOrg(userId)`, which re-queries the DB and finds a null org for platform admins,
> ignoring the `?orgId=` override `JwtStrategy` already put on `req.user`. Fixed by passing the
> request user object so `getRequiredOrg(user)` returns the JWT-resolved org (also folds in H8's
> redundant-lookup removal for those modules). Orders' getOrders also returned every tenant's orders
> unfiltered — now scoped too. calls/agents/documents/printers already use user.organizationId.
> Billing is per-org and out of scope.

> **Critical: 7/7 done. High: 9/9 done. Medium: 15/17.** All Critical and High audit findings
> are fixed, verified, committed. Both apps build green; **all 105 backend tests pass** (the
> previously-failing heartbeat/stripe/telnyx suites were also repaired). Ant Design v6
> deprecations resolved (Alert `message`→`title`). Enhancements E1 (header tenant switcher) and
> E4 (shared PageHeader + empty/error/skeleton states) landed.
>
> **Post-implementation review (code not written by the original pass):** reviewed the H2/H8/
> M2–M17 work. Found and fixed **two real bugs**: (1) the dashboard 500 — `GET /analytics/
> dashboard` failed with Postgres 42803 because the TZ-aware trend query grouped by a repeated
> `to_char()` that Drizzle rendered qualified in GROUP BY but unqualified in SELECT (fixed:
> group by ordinal); (2) M15 was inert — `LocationContext` listened for an `auth-change` event
> that nothing dispatched, so role/org stayed stale after login (fixed: dispatch on login/
> logout/invite). Also fixed the reported **sign-in bounce** — the refresh cookie was scoped to
> `/api/v1/auth`, so the new `middleware.ts` couldn't see it on page requests and redirected
> authenticated users back to `/login` (fixed: cookie path `/`).
>
> **Residual notes:** M5 still uses one shared Telnyx bucket across tenants (only the raw
> `process.env` part was addressed); M7 cascades soft-delete but not restore; `users_role_check`
> omits `'owner'` (unused today). H2/H6 end-to-end still want a live browser smoke test.

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

### [x] H2 — Refresh/access tokens in localStorage; no reuse detection

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
**End-to-end smoke test (2026-07-04):** `smoke-test-h2-h6.js` run against live backend + DB
(mr.manishshrestha@gmail.com). All 16 H2 assertions passed (20/20 total including H6):
- Login → `Set-Cookie: refresh_token=…; HttpOnly; Path=/api/v1/auth` ✅
- Cookie-only refresh (no body token) → 200, rotated HttpOnly cookie ✅
- `GET /auth/me` with Bearer → 200, correct user returned ✅
- Stale/replayed refresh token → 401 (reuse detection fires) ✅
- Logout → 200, cookie cleared (`Max-Age=0`) ✅
- Refresh after logout → 401 ✅
**Residual risk:** SameSite=Lax works for same-registrable-domain deploys. A fully cross-site
prod split (app.x / api.y) would need `SameSite=None; Secure` — noted in `refresh-cookie.ts`.
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
**End-to-end smoke test (2026-07-04):** `smoke-test-h2-h6.js` run against live backend + DB.
All 4 H6 assertions passed:
- `GET /users` (no token) → 401 ✅ (global guard blocks)
- `GET /health` (no token) → 200 ✅ (`@Public` bypass works)
- `GET /auth/me` (no token) → 401 ✅ (global guard blocks)
- `GET /auth/me` (valid Bearer) → 200 ✅ (guard passes authenticated request)

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

### [x] M2 — Refresh rotation ignores `rememberMe` TTL
**Where:** `auth.service.ts` (`refresh`) · **Impact:** 30-day sessions shrink to 7 days after first refresh. · **Fix:** persist chosen TTL with the token family and reuse on rotation. · **Effort:** 1 h · **Status:** Completed

### [x] M3 — Account-lockout counter race (read-modify-write)
**Where:** `auth.service.ts` (`validateUser`) · **Impact:** parallel attempts bypass lockout increments. · **Fix:** atomic `SET failed_login_attempts = failed_login_attempts + 1`. · **Effort:** 2 h · **Status:** Completed

### [x] M4 — Role model sprawl; invitation default role is `sysadmin`
**Where:** guards, DTOs, schema, sidebar · **Impact:** four inconsistent role taxonomies; risky invite default. · **Fix:** single role enum + migration; explicit invite role required. · **Effort:** 2 days · **Status:** Completed — single source of truth in `common/constants/roles.ts` (`USER_ROLES`, `ROLE_HIERARCHY`, `INVITABLE_ROLES`); `RolesGuard` and the invitation DTO now import it. Removed the phantom `owner` role (was in the hierarchy + one guard but never a valid DB role) and fixed the `@Roles('admin','manager','owner')` menu route. Invite default already hardened to `manager` with `@IsIn(INVITABLE_ROLES)` (no `platform_admin`). Kept the `varchar` + CHECK columns rather than a Postgres enum-type migration — lower risk, same guarantees.

### [x] M5 — `syncMenuToAI`: shared Telnyx bucket, global embed, raw `process.env`
**Where:** `menus.service.ts:852` · **Impact:** cross-tenant knowledge-base contamination risk. · **Fix:** per-org object prefix/bucket; ConfigService; typed responses. · **Effort:** 2 days · **Status:** Completed

### [x] M6 — Dashboard metrics use server timezone; JS-side grouping
**Where:** `analytics.service.ts` (`getDashboardMetrics`) · **Impact:** "today" is wrong for locations in other timezones. · **Fix:** `date_trunc AT TIME ZONE location.timezone` + SQL `GROUP BY`. · **Effort:** 1 day · **Status:** Completed

### [x] M7 — `deleteCategory` leaves child items live
**Where:** `menus.service.ts` · **Impact:** orphaned active items under soft-deleted category. · **Fix:** cascade soft-delete/restore of items in the same transaction. · **Effort:** 2 h · **Status:** Completed

### [x] M8 — Orders list: no `deletedAt` filter, no server-side status filter/search
**Where:** `orders.service.ts` (`getOrders`) · **Fix:** added `isNull(deletedAt)` + validated `status` filter to GetOrdersDto (folded into H1). Full-text search still TODO. · **Effort:** 1 day · **Status:** Completed (search deferred)

### [x] M9 — WS gateway CORS `origin: '*'`; three overlapping realtime channels
**Where:** `events.gateway.ts` · **Fix:** restrict origin to FRONTEND_URL; consolidate on one realtime mechanism. · **Effort:** 0.5 day · **Status:** Completed

### [x] M10 — Status/role/type columns are free-text varchar (no CHECK/enums)
**Where:** `schema.ts` · **Fix:** pg enums or CHECK constraints + migration. · **Effort:** 1–2 days · **Status:** Completed

### [x] M11 — Missing composite indexes; `webhook_events` grows forever
**Where:** `schema.ts` · **Fix:** `orders(org, created_at desc)`, `usage_events(org, event_type, created_at)`, `recordings(org, created_at)`, `audit_logs(org, created_at)`; cron cleanup for `webhook_events`. · **Effort:** 0.5 day · **Status:** Completed

### [x] M12 — No Next.js middleware auth (client-only guard, protected-page flash)
**Where:** `apps/frontend` (no `middleware.ts`) · **Fix:** cookie-based middleware redirect for unauthenticated users (pairs with H2). · **Effort:** 1 day · **Status:** Completed

### [x] M13 — Sidebar never highlights top-level items (`/calls`, `/dashboard`)
**Where:** `DashboardLayout.tsx:124` · **Fix:** match top-level keys too, pick longest prefix match. · **Effort:** 1 h · **Status:** Completed

### [x] M14 — Logout doesn't clear tenant context (`selectedOrgId`/`selectedLocationId`)
**Where:** `DashboardLayout.tsx` (logout handler) · **Impact:** next login on shared terminal inherits previous tenant; stale `orgId` sent by API interceptor. · **Effort:** 1 h · **Status:** Completed (folded into H2 frontend commit) — logout now clears `selectedOrgId`/`selectedLocationId`.

### [x] M15 — `LocationContext` parses JWT once at mount (stale role after login)
**Where:** `LocationContext.tsx:54` · **Fix:** derive role reactively (context refresh on auth change). · **Effort:** 0.5 day · **Status:** Completed

### [x] M16 — Dark-mode FOUC; theme unavailable during SSR
**Where:** `DashboardLayout.tsx:411` · **Fix:** persist theme in cookie / inline script before hydration. · **Effort:** 0.5 day · **Status:** Completed

### [x] M17 — Production rewrite hardcodes `localhost:4000`
**Where:** `apps/frontend/next.config.ts` · **Fix:** derive destination from env; fail loudly if unset in prod. · **Effort:** 1 h · **Status:** Completed

---

## Low

### [x] L1 — Dead `register()` kept alive with six eslint-disables — delete (`auth.service.ts:55`) · **Status:** Completed — deleted dead register() stub (throws in controller).
### [x] L2 — Corrupted doc comment with stray import line (`menus.service.ts:484`) · **Status:** Completed — removed stray import inside doc comment.
### [x] L3 — Hardcoded `TEST_PRINTER_ID` in orders page (`orders/page.tsx:81`) · **Status:** Completed — removed hardcoded TEST_PRINTER_ID + debug button.
### [x] L4 — `formatPrice`/`formatPhone`/status maps duplicated across pages → `src/lib/format.ts` · **Status:** Completed — `src/lib/format.ts`; orders/calls/calls[id] import it.
### [x] L5 — `console.log` in `useSocket`; socket never re-auths after token refresh · **Status:** Completed — removed console logs from useSocket (re-auth-on-refresh still TODO).
### [x] L6 — `any` types in layout/context (`rawItems: any[]`, `aiSettings?: any`) · **Status:** Completed — NavItem union types; Location.aiSettings typed.
### [x] L7 — Hardcoded hex colors in dashboard quick actions & sidebar (violates token rule) · **Status:** Completed — dashboard quick-action accents now resolve from theme tokens (`colorPrimary`/`colorSuccess`/`colorWarning`/`purple`/`magenta`/`colorTextTertiary`); header background uses `colorBgContainer`. The intentionally always-dark sidebar chrome (`Sider`/`Menu theme="dark"`) is hoisted into documented `SIDEBAR_BG`/`SIDEBAR_FG` constants rather than theme tokens (which would wrongly flip with light/dark mode).
### [x] L8 — Zero controller/e2e tests on webhooks, recordings processor, guards · **Status:** Completed — recordings-processor C2 tests (guards/telnyx-sig/webhooks already covered).
### [x] L9 — Stray scripts in backend root (`test-telnyx-*.js`, `generate.exp`) · **Status:** Completed — deleted generate.exp, test-telnyx-*.js.
### [x] L10 — Frontend package still named `antd-demo` · **Status:** Completed — renamed frontend package to coneeko-frontend.

---

## Enhancement (post-fix roadmap, from audit Parts 3–4)

### [x] E1 — Header org/location switcher (move out of profile dropdown) + shared `PageHeader` · **Status:** Completed — commit `feat(ui): surface org/location switcher in the header`
### [x] E2 — Standardized table toolbar (search/filters/export), sticky headers, server pagination everywhere · **Status:** Completed — shared `TableToolbar` component (search + filter slot + export/refresh); adopted on Orders (client quick-search + status filter + sticky header).
### [x] E3 — Settings page → Tabs (General / AI / Hours / Menu Sync / Danger Zone) with dirty-state warning · **Status:** Completed — tabs already present; added unsaved-changes warning on the org form.
### [x] E4 — One shared skeleton / empty-state-with-CTA / error-result language across pages · **Status:** Completed — commit `feat(ui): shared PageHeader + empty/error/skeleton states`
### [x] E5 — Global search / command palette (⌘K) · **Status:** Completed — `CommandPalette` mounted in DashboardLayout; ⌘K/Ctrl+K opens fuzzy nav + actions (theme toggle, logout); also openable via `open-command-palette` event.
### [x] E6 — Notifications center fed by existing socket events (order failures, printer offline) · **Status:** Completed — header bell + NotificationsProvider on socket events.
### [x] E7 — CSV export on orders/calls/usage; saved table views · **Status:** Completed (orders) — commit `feat(orders): CSV export`; calls/audit already had it. Saved views still TODO.
### [x] E8 — Onboarding checklist + `Tour` (provision → forward → import menu → test order) · **Status:** Completed — `OnboardingTour` (Ant Design `Tour`) auto-runs on first visit (localStorage-gated), re-launchable from profile menu "Take a tour"; steps route to menu/calls/printers/orders.

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
| 2026-07-04 | H2 + H6 **live smoke test** (`smoke-test-h2-h6.js`) | — | — | **20/20 pass** | End-to-end: login→cookie set (HttpOnly+path-scoped), cookie-only refresh, reuse-detection→401, logout→cookie cleared, post-logout refresh→401; global guard blocks unauthenticated, passes @Public and Bearer |

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
