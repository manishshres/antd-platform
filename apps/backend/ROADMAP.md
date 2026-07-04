# SaaS Platform Roadmap — antd-backend (NestJS API)

This roadmap tracks all development phases for the Call Center AI SaaS backend.

> **Status Key**: ✅ Complete · 🔄 In Progress · 📋 Planned · 🔮 Future

---

## ✅ Phase 1 — Foundation & Authentication

- [x] NestJS 11 project scaffolded with TypeScript strict mode
- [x] Docker Compose: PostgreSQL + Redis + Mosquitto MQTT for local development
- [x] Drizzle ORM configured with `schema.ts` as single source of truth
- [x] Core tables: `users`, `refresh_tokens`, `organizations`, `plans`, `subscriptions`
- [x] JWT Authentication: Register, Login, Logout, Token Refresh
- [x] Role enforcement: prevent public registration from claiming `admin` role
- [x] Swagger / OpenAPI at `/api/docs`
- [x] Next.js proxy rewrite: `/api/v1/*` → NestJS `:4000`

---

## ✅ Phase 2 — Billing, Subscriptions & Plan Limits

- [x] Multi-tenant schema: Organizations, Plans, Subscriptions
- [x] Stripe Checkout Session creation
- [x] Stripe Customer Portal session
- [x] Stripe Webhook handler: `checkout.session.completed`, `subscription.updated`, `subscription.deleted`
- [x] Plan limit guard (`@CheckLimit` decorator) enforced per-feature
- [x] Auto-seeding default plans (`free`, `growth`, `enterprise`) on startup

---

## ✅ Phase 3 — Voice AI & Call Logs Migration

- [x] `TelnyxModule`: proxy all Telnyx API calls through NestJS (keeps keys server-side)
- [x] `AgentsModule`: CRUD for voice AI agent configuration
- [x] `CallsModule`: call logs, recording streaming proxy, transcriptions
- [x] `DocumentsModule`: file uploads with magic-byte security scanning
- [x] Frontend decoupled: all API calls go through `api.ts` → `/api/v1/`

---

## ✅ Phase 4 — Menu Management & Website Importing

- [x] `categories` and `menu_items` tables with sort ordering (location-scoped)
- [x] `menu_modifiers` and `menu_item_modifiers` tables for item customization (location-scoped)
> **Note**: Menus are strictly tied to a specific location, not the organization as a whole, because different locations within the same org can have entirely different menus.
- [x] `MenusModule`: full CRUD for categories and menu items
- [x] `CrawlerService`: HTML scraping with Cheerio + header impersonation
- [x] `AiExtractorService`: Gemini API extraction with keyword-based mock fallback
- [x] `POST /api/v1/menus/import`: transactional menu seeding from a URL

---

## ✅ Phase 5 — Orders, Webhooks & MQTT Printing

### Orders

- [x] `orders` and `order_items` tables
- [x] `OrdersModule`: create, list, update status (pending → preparing → ready → completed/cancelled)
- [x] Total amount calculation from menu item prices at time of order
- [x] Mock order generator for development testing

### Webhooks (QoS & Queue Ingestion)

- [x] `POST /api/v1/webhooks/ai/order` — AI voice agent order ingestion
  - API Key authentication (`X-API-Key` header)
  - Per-organization API key stored in DB
  - Return `202 Accepted` immediately, offloaded to `webhook-queue`
- [x] Webhook API key rotation endpoints for organizations

### MQTT Printing

- [x] `MqttService`: connect to Mosquitto broker, publish/subscribe
- [x] Topic schema: `restaurant/{orgId}/kitchen/print`, `restaurant/{orgId}/receipt/print`
- [x] `PrinterService`: ESC/POS packet builder and prod MQTT publish
- [x] BullMQ `print-queue`: retry on failure, dead letter queue for permanent failures
- [x] Automatic reconnection logic for MQTT client
- [x] Offline queue: buffer print jobs when broker unavailable
- [x] `printerId` optional in print requests; supports fixed `/print` topics and direct printer command topics
- [x] Organization printer config API: `GET /api/v1/printer-config`, `PUT /api/v1/printer-config`

---

## ✅ Phase 6 — Printer Management & Monitoring

- [x] `printers` table: `id`, `name`, `topic`, `locationName`, `organizationId`, `isOnline`, `lastHeartbeatAt`, `ipAddress`, `model`, `type`, `notes`
- [x] `PrintersRegistryService` + `PrintersRegistryController` with full CRUD for printer registration
- [x] Admin endpoints:
  - `GET /printers` — list all printers with online status
  - `POST /printers` — register a new printer
  - `GET /printers/:id` — get printer details
  - `PATCH /printers/:id` — update printer config
  - `DELETE /printers/:id` — soft-delete printer
  - `POST /printers/:id/test-print` — send test job via MQTT
  - `POST /printers/:id/restart` — send restart command via MQTT control topic
  - `GET /printers/:id/queue` — view pending/failed jobs for printer
  - `POST /printers/:id/reprint/:jobId` — retry a failed print job
- [x] MQTT Last Will & Testament (LWT) configured on broker connect
- [x] `subscribe()` method on `MqttService` with wildcard pattern matching + reconnect replay
- [x] `HeartbeatService`: subscribes to `restaurant/+/printer/+/heartbeat`, updates `isOnline` + `lastHeartbeatAt`
- [x] `@Interval(30s)` sweep: marks printers offline after 60s without heartbeat
- [x] Dead-letter queue API: `GET /print-jobs/dead-letter`, `POST /print-jobs/:id/requeue`

## ✅ Phase 7 — Advanced Auth & User Management

- [x] **Forgot password flow**: `POST /auth/forgot-password` → sends email reset token (MailService with SMTP/mock fallback)
- [x] **Password reset**: `POST /auth/reset-password` → validates token, hashes new password, revokes active sessions
- [x] **Email verification**: auto-generate token on registration, endpoint `POST /auth/verify-email`, resend `POST /auth/resend-verification`
- [x] **Account lockout**: locked after 5 failed attempts, unlocks after 15 mins (throttled validateUser)
- [x] **Remember me**: extends refresh token TTL to 30 days when rememberMe is set to true during login
- [x] **Full user CRUD**: `GET/PATCH/DELETE /api/v1/users` (admin only, organization-scoped), `GET/PATCH /users/me` (self profile management)
- [x] **Force logout**: `POST /api/v1/users/:id/force-logout` to revoke all refresh tokens (admin only)
- [x] **User activity history**: tracks `lastLoginAt` and failed attempts directly on user schema
- [x] **Hierarchical roles**: `RolesGuard` updated to support hierarchical role weights (`owner` > `admin` > `manager` > `agent` > `viewer` > `user`)
  > ⚠️ **Audit Finding**: `RolesGuard` only defines 3 weights (`sysadmin`, `admin`, `user`). The 6-role hierarchy documented here is non-functional. Fixed in Phase 9A role consolidation.

---

## ✅ Phase 8 — Security Hardening & Refactoring

- [x] **Helmet.js** for secure HTTP headers (`Content-Security-Policy`, `X-Frame-Options`, etc.)
- [x] **Rate limiting** via `@nestjs/throttler` — `ThrottlerModule` configured and applied to auth/webhook endpoints
- [x] **Input validation** via `class-validator` on all DTOs (whitelist enabled)
- [x] **Secure Refresh Tokens**: SHA-256 token hashing and key rotation implemented
- [x] **Tenant Scoping Guard**: global `@CurrentUser()` context propagation and scoping on all controllers
- [x] **Telnyx White-Labeling**: neutral, provider-agnostic DTO mappings on all customer-facing boundaries
- [x] **Global Exception Handling**: normalized error shape wrapper preventing stack traces leakage
- [x] **Audit log wiring**: `auditService.log()` integrated into all state-changing endpoints (auth, orders, menus, users, orgs)
- [x] **`StripeService` fail-fast**: throws on startup if `STRIPE_API_KEY` is missing instead of falling back to `'sk_test_placeholder'`; allows dev-mode warning only when `NODE_ENV=development`

---

## 📋 Phase 8.5 — Pre-Migration Hardening

> **Goal**: Fix correctness bugs, data-integrity gaps, and missing safeguards discovered during audit. These issues are cheaper to fix before the Phase 9 schema migration and will compound into harder bugs if deferred.

**Priority**: 🔴 Critical — Must complete before Phase 9A
**Depends on**: Phase 8
**Estimated**: 1 week

### Data Integrity & Correctness

- [x] **Transaction wrapping for order creation**: `createOrderForOrg` performs 3 sequential DB operations (insert order → insert items → re-read order) without a transaction. If item insert fails, an order with partial/no items exists and print jobs may be enqueued for an inconsistent order. Wrap in `this.db.transaction()`
- [x] **N+1 query fix in order creation**: `createOrderForOrg` issues a separate `SELECT` per order item to resolve menu prices. Replace the `for` loop with a single `inArray(schema.menuItems.id, itemIds)` batch query (per `AGENTS.md` Anti-Pattern Rule #1)
- [x] **Soft delete filters for menus**: `categories` and `menu_items` tables have `deletedAt` columns but no query filters. Add `isNull(schema.categories.deletedAt)` and `isNull(schema.menuItems.deletedAt)` to all menu queries in `MenusService`

### Business Logic Safeguards

- [x] **Order status state machine**: `updateOrderStatus` accepts any valid status string regardless of current state (`completed` → `pending` is allowed). Implement a transition map enforcing:
  ```
  pending → preparing → ready → completed
  pending → cancelled
  preparing → cancelled
  ```
- [x] **Webhook API key hashing**: `webhookApiKey` is stored and compared in plaintext in `organizations` table. Apply SHA-256 hashing (same pattern as refresh tokens). Show raw key only once on creation/rotation. Requires migration for existing orgs

### Testing Foundation

- [x] **Unit test setup**: zero `.spec.ts` files exist despite `AGENTS.md` requiring `npm run test` to pass. Create foundational unit tests for critical services:
  - `AuthService`: token lifecycle, password hashing, lockout logic, email verification flow
  - `OrdersService`: order creation (with transaction), status transitions (state machine)
  - `PrinterService`: ESC/POS packet building, topic resolution
  - `WebhooksController`: API key validation, BullMQ job enqueue
  - `BillingService`: org resolution, checkout session creation
  - `HeartbeatService`: heartbeat handling, stale printer sweep

---

## 📋 Phase 8.6 — Technical Debt & Refactoring

> **Goal**: Address codebase cruft, eliminate strict mode test failures, and enforce safer query patterns natively.

**Priority**: 🟡 High — Better to fix before further scaling
**Depends on**: Phase 8.5
**Estimated**: 1 week

- [x] **Decouple Modules**: Introduce `@nestjs/event-emitter` to remove circular dependencies (`forwardRef`) between `OrdersModule` and `WebhooksModule`.
- [x] **Soft Delete Enforcement**: Implement a global Drizzle middleware, base repository pattern, or query wrappers to natively enforce `isNull(deletedAt)` across queries, replacing manual checks.
- [x] **Test Type Safety**: Resolve `any` usage, unsafe assignments, and linting errors across `.spec.ts` and `.e2e-spec.ts` files to achieve a fully clean strict-mode CI build.

---

## 📋 Phase 9 — Multi-Tenant Architecture, Locations & Organization Provisioning

> **Goal**: Implement a partitioned multi-tenant architecture with a `locations` table as the operational boundary. Organizations group locations; each location owns its own Telnyx phone number, AI agent, printers, menu, and orders. Automate the full org + first-location lifecycle — from Telnyx resource provisioning to admin onboarding — via BullMQ background jobs.

### Data Model

```
Platform
└── platform_admin
      │
      ├── Organization A (branding, settings)
      │     ├── sysadmin (sees all locations)
      │     ├── Location: Philadelphia
      │     │     ├── Subscription & Billing (Stripe)
      │     │     ├── Phone Number (provisioned from Telnyx)
      │     │     ├── AI Agent (cloned from master)
      │     │     ├── Printers
      │     │     ├── Menu (categories, items, and modifiers)
      │     │     ├── Orders
      │     │     └── manager (scoped to this location)
      │     ├── Location: NYC
      │     │     └── manager
      │     └── Location: Baltimore
      │           └── manager
      │
      └── Organization B
            ├── sysadmin
            └── Location: Toronto
                  └── manager
```

### 9A — Database Schema, Locations Table & Role System

**Priority**: 🔴 Critical — Foundation for all provisioning work
**Depends on**: Phase 8.5 (Pre-Migration Hardening)
**Estimated**: 2 weeks (expanded from 1.5 weeks to include audit-driven tasks)

#### Schema & Tables

- [x] **`locations` table**: `id`, `organizationId`, `name`, `slug`, `address`, `city`, `state`, `country`, `timezone`, `businessHours` (jsonb), `phoneNumber`, `telnyxPhoneNumberId`, `telnyxAssistantId`, `masterAgentId`, `webhookApiKey`, `status` (`draft` | `provisioning` | `active` | `suspended`), `provisioningError`, `provisioningStartedAt`, `provisioningCompletedAt`, `deletedAt`, `createdAt`, `updatedAt`
- [x] **Schema refactoring**: migrate operational FK references from `organizationId` → `locationId`:
  - `orders.locationId`, `categories.locationId`, `menu_items.locationId`, `menu_modifiers.locationId`, `printers.locationId`, `print_jobs.locationId`, `org_agents.locationId`, `org_phone_numbers.locationId`, `subscriptions.locationId`
  - Keep `organizationId` on these tables as a denormalized field for fast org-level queries
- [x] **Location-level billing**: `subscriptions` table gets `locationId` FK — each location has its own Stripe subscription and plan. Stripe customer ID stays on the organization (single Stripe customer per org, multiple subscriptions per location)
- [x] **`org_provisioning_steps` table**: step-level tracking for granular retry (`stepName`, `stepOrder`, `status`, `attempts`, `lastError`, `metadata`, timestamps)
- [x] **`org_invitations` table**: `email`, `role`, `tokenHash`, `status` (`pending` | `accepted` | `expired` | `revoked`), `expiresAt`, `acceptedAt`, `invitedByUserId`
- [x] **Organization status column**: `status` on `organizations` (`draft` | `provisioning` | `active` | `suspended` | `archived`)
- [x] **Database indexes**: add Drizzle `.index()` for all `organizationId` FK columns and other high-frequency query predicates — currently no explicit indexes exist on `orders.organizationId`, `categories.organizationId`, `printers.organizationId`, `printJobs.organizationId`, `printJobs.orderId`, `auditLogs.organizationId`, `auditLogs.createdAt`

#### Role System & Guards

- [x] **Simplified 3-role hierarchy** — consolidate the existing 6-role system (which only has 3 weights implemented in code) into the production-ready hierarchy:
  - `platform_admin` (weight: 100) — platform scope, `organizationId = null`
  - `sysadmin` (weight: 50) — organization scope, sees all locations
  - `manager` (weight: 30) — location scope, assigned to specific location(s)
- [x] **`PlatformAdminGuard`**: replaces all 8 hardcoded `user.email !== 'admin@manish.dev'` checks across `UsersController` and `OrganizationsController`
- [x] **`OrgStatusGuard`**: rejects requests if org is `suspended` or `archived`
- [x] **`locationId` on users table**: for manager-level location scoping

#### Auth & Registration Refactoring

- [x] **Disable self-registration**: remove org-creation logic from `POST /auth/register`, make it invitation-only
- [x] **Remove `getOrCreateUserOrg` pattern**: replace all ~18 call sites of `billingService.getOrCreateUserOrg(userId)` with a strict `getRequiredOrg(userId)` that throws `ForbiddenException` if no org exists. Auto-creating garbage organizations on any API call is incompatible with the invitation-only provisioning model
- [x] **Platform admin seed script**: `npx ts-node src/seeds/platform-admin.seed.ts`

#### Shared Utilities (Audit-Driven)

- [x] **Register `MailService` in `CommonModule`**: currently only exported from `AuthModule` locally — future `InvitationsModule` and `ProvisioningModule` cannot inject it. Add to `CommonModule` providers/exports
- [x] **Extract `generateUniqueSlug()` utility**: duplicate slug generation logic exists in `AuthService.register()` and `OrganizationsService.createOrganizationGlobal()` — extract to `src/common/utils/slug.util.ts`
- [x] **Remove redundant dynamic `import()` calls**: `billing.service.ts` uses `await import('crypto')` and `users.service.ts` uses `await import('bcrypt')` in 3 locations despite both modules being statically imported at the top of their files

### ✅ Phase 9B — Telnyx Resource Provisioning & Agent Cloning

**Priority**: 🔴 Critical — Core provisioning pipeline
**Depends on**: Phase 9A
**Estimated**: 2 weeks

- [x] **TelnyxService extensions** (new methods on `src/telnyx/telnyx.service.ts`):
  - `searchAvailableNumbers(countryCode, state?, city?, limit?)` → `GET /v2/available_phone_numbers`
  - `createNumberOrder(phoneNumber)` → `POST /v2/number_orders`
  - `getNumberOrder(orderId)` → `GET /v2/number_orders/{id}` (poll until success)
  - `updatePhoneNumber(phoneNumberId, body)` → `PATCH /v2/phone_numbers/{id}`
  - `deletePhoneNumber(phoneNumberId)` → `DELETE /v2/phone_numbers/{id}`
  - `cloneAssistant(assistantId)` → `POST /v2/ai/assistants/{id}/clone`
  - `deleteAssistant(assistantId)` → `DELETE /v2/ai/assistants/{id}`
- [x] **Master agent**: `TELNYX_MASTER_AGENT_ID=assistant-5966713f-9eb2-4b68-bdda-22a1fd4820b3`
- [x] **Single Telnyx account**: all orgs share one API key; ownership tracked in DB
- [x] **`ProvisioningModule`** (`src/provisioning/`):
  - `POST /api/v1/admin/organizations` — create org + first location + enqueue provisioning
  - `GET /api/v1/admin/organizations/:id/provisioning-status` — poll step progress
  - `POST /api/v1/admin/organizations/:id/retry` — retry all failed steps
  - `POST /api/v1/admin/organizations/:id/deprovision` — release Telnyx resources, archive org
- [x] **BullMQ `provisioning-queue`** with `ProvisioningProcessor`:
  1. Search phone number (country, state, city)
  2. Purchase phone number via number order
  3. Clone master agent `assistant-5966713f-9eb2-4b68-bdda-22a1fd4820b3`
  4. Assign phone number to cloned agent
  5. Configure cloned agent with location-specific data (name, hours, menu URL, greeting)
  6. Register webhook + generate org `webhookApiKey`
  7. Send admin invitation email
  - Each step tracked in `org_provisioning_steps`, 3 retries, exponential backoff
  - No clone fallback — fail, save error, allow platform admin to retry

### ✅ Phase 9C — Invitation & Onboarding Workflow

**Priority**: 🟡 High — Completes provisioning lifecycle
**Depends on**: Phase 9B
**Estimated**: 1.5 weeks

- [x] **`InvitationsModule`** (`src/invitations/`):
  - `POST /api/v1/admin/organizations/:id/invite` — platform admin sends invite (email + role)
  - `GET /api/v1/invitations/:token/validate` — **public**: validate token, return org name
  - `POST /api/v1/invitations/:token/accept` — **public**: create account, assign to org, return JWT
  - `GET /api/v1/admin/organizations/:id/invitations` — list invitations for an org
  - `POST /api/v1/admin/invitations/:id/revoke` — revoke pending invitation
  - `POST /api/v1/admin/invitations/:id/resend` — resend invitation email
- [x] **Accept flow**: validate SHA-256 token → create user as `sysadmin` → auto-verify email → return JWT tokens
- [x] **Organization lifecycle management**:
  - `PATCH /api/v1/admin/organizations/:id/status` — transition: `active` ↔ `suspended`, `suspended` → `archived`
  - Suspending: org-scoped JWT requests return `403`
  - Archiving: release Telnyx resources, revoke all tokens, soft-delete users
- [x] **Location AI config** (org sysadmin):
  - `PATCH /api/v1/locations/:id/ai-config` — update dynamic variables (business name, hours, greeting, etc.)
  - Changes synced to Telnyx cloned agent via BullMQ job (non-blocking)

---

## ✅ Phase 10 — Provisioning Observability, Audit & Error Recovery

**Priority**: 🟡 High — Operational reliability for production
**Depends on**: Phase 9C
**Estimated**: 1 week

- [x] **Provisioning dashboard endpoints** (platform admin):
  - `GET /api/v1/admin/provisioning/summary` — aggregate stats
  - `GET /api/v1/admin/provisioning/failures` — list failed provisioning orgs
  - `POST /api/v1/admin/provisioning/:orgId/retry-step/:stepId` — retry specific step
  - `POST /api/v1/admin/provisioning/:orgId/skip-step/:stepId` — manual override
- [x] **Enhanced audit logging** for provisioning lifecycle:
  - `org.created`, `org.provisioning.started`, `org.provisioning.step_completed`, `org.provisioning.step_failed`
  - `org.provisioning.completed`, `org.provisioning.retried`
  - `org.suspended`, `org.archived`, `org.reactivated`
  - `org.invitation.sent`, `org.invitation.accepted`, `org.invitation.expired`, `org.invitation.revoked`
  - `org.deprovisioned`, `location.created`, `location.ai_config.updated`
- [x] **Cron jobs** (BullMQ scheduled):
  - `invitation-expiry-sweep` — hourly: mark expired invitations
  - `provisioning-timeout-sweep` — every 15 min: detect stuck jobs, alert platform admin
  - `telnyx-resource-sync` — daily: verify phone numbers + agents still exist in Telnyx
- [x] **Idempotent step execution**: each step checks completion before re-running
- [x] **Manual override**: platform admin can set step status for edge cases

---

## 📋 Phase 11 — Alpha Stabilization & Testing

> **Goal**: Freeze feature development to ensure a highly stable, production-ready Alpha release through comprehensive testing and bug resolution.

**Priority**: 🔴 Critical — Next Immediate Step
**Depends on**: Phase 10 & 14
**Estimated**: 2 weeks

- [x] **Test Suite Coverage**: Write foundational unit tests for core services (`AuthService`, `OrdersService`, `BillingService`, `WebhooksService`, `PrinterService`).
- [x] **Strict Linting Compliance**: Fix all remaining `any` types and unsafe assignments in `.spec.ts` and `.e2e-spec.ts` files.
- [x] **Data Safety Enforcements**: Implement global soft-delete query wrappers to prevent data leaks.
- [x] **Business Logic Bug Fixes**:
  - Enforce strict Order Status state machine transitions.
  - Implement SHA-256 hashing for webhook API keys.

---

# Post-Alpha (Beta & V1 Roadmap)

> The following phases are deferred until after the successful launch of the Alpha version.

## ✅ Phase 12 — Recording & Conversation Storage

- [x] **Object storage integration**: upload call recordings to Cloudflare R2 / S3
- [x] `recordings` table: `url`, `duration`, `callId`, `transcript`, `aiSummary`, `sentiment`, `tags`, `callOutcome`
- [x] `POST /recordings/:id/upload` — upload from Telnyx to R2 (handled automatically via BullMQ sync worker)
- [x] Transcript storage and full-text search (PostgreSQL `tsvector` or Meilisearch)
- [x] AI-generated call summaries (Gemini)
- [x] Chat conversation storage
- [x] Retention policy: auto-delete recordings after N days (configurable per plan)
- [x] GDPR-compliant deletion: soft delete + scheduled hard delete job
- [x] Export: download transcript as PDF or CSV

---

## ✅ Phase 13 — Admin Dashboard, Usage Tracking & Health Checks

### Tenant-Level Usage Tracking

- [x] `usage_events` table: track per-location counters with timestamps and metadata
- [x] Track: monthly inbound/outbound minutes, call counts, SMS usage, recording storage, AI transcription usage, AI summary usage, API request counts
- [x] Peak usage metrics: concurrent call high-water mark, hourly/daily aggregations
- [x] `GET /analytics/usage` — return current period usage vs plan limits (org-wide, per-location)
- [x] Usage reset job: BullMQ cron to reset monthly counters on billing cycle date

### Location-Level Billing Dashboards

- [x] `GET /billing/locations/:id/usage-summary` — monthly usage summary per location with estimated costs
- [x] `GET /billing/locations/:id/subscription` — current subscription, plan, and status for a location
- [x] `GET /billing/history` — past invoices and payment history (via Stripe, org-level Stripe customer)
- [x] `GET /billing/overview` — aggregated billing across all locations for sysadmin view
- [x] Invoice generation: PDF invoice from per-location usage data
- [x] Margin reporting: estimated cost vs revenue per location

### API Pagination

- [x] **Cursor-based or offset pagination** on all list endpoints — currently all return unbounded result sets:
- [x] **API Pagination Standardization**

- [x] `PaginationDto` standard: `offset`, `limit` (default 20, max 100), `sortBy`, `sortOrder`
- [x] `PaginatedResponseDto`: `{ data: T[], meta: { total, offset, limit, hasMore } }`
- [x] Apply pagination to all list endpoints: orders, menus, users, recordings, locations

### System Health Monitoring (Complete)

- [x] `GET /api/v1/health` — overall system health (PostgreSQL check, Redis check, MQTT broker check)
- [x] `GET /api/v1/health/metrics` — application performance metrics (uptime, memory, CPU usage)

---

## ✅ Phase 14 — Multi-Location Expansion & Scalability

- [x] **Add location to existing org**: `POST /api/v1/admin/organizations/:id/locations` — provisions a new location with its own phone + agent
- [x] **Location-level manager assignment**: `POST /api/v1/locations/:id/assign-manager` — invite or assign user as location manager
- [x] **Feature Flags:** Add JSONB field for org-level feature toggles.
- [x] **Webhooks (Outbound):** Queue (BullMQ) & dispatch events on order state changes.
- [x] **Localization prep:** Use `location` timezone settings when formatting printer receipts.
- [x] **MQTT Optimization:** Simple regex cache on `topicMatchesPattern` to reduce parsing overhead on high-frequency topics.
- [x] **Public API v2**: versioned, rate-limited, API-key-authenticated for third-party integrations

---

## ✅ Phase 15 — Scalability, Idempotency & Caching

> **Goal**: Optimize the platform for high concurrency and ensure safe retries across distributed systems.

**Priority**: 🟡 Medium
**Estimated**: 1.5 weeks

- [x] **Menu Caching**: Introduce Redis caching for `GET /api/v1/menus` to serve read-heavy menu fetches efficiently. Setup invalidation hooks on menu item/category mutation.
- [x] **Webhook Idempotency**: Implement Idempotency-Key validation in `webhook-queue` and `outbound-webhooks-queue` to prevent duplicate state updates during external retry storms.

---

## Implementation Dependencies Graph

```
Phase 8.5 (Pre-Migration Hardening)
 └─▶ Phase 8.6 (Technical Debt & Refactoring)
      └─▶ Phase 9A (Schema, Locations & Roles)
           ├─▶ Phase 9B (Telnyx Provisioning & Agent Cloning)
           │    └─▶ Phase 9C (Invitation & Onboarding)
           │         └─▶ Phase 10 (Observability, Audit & Recovery)
           │              └─▶ Phase 14 (E2E Provisioning Testing)
           └─▶ (9A unblocks 9B and 9C sequentially)

Phase 11 (Alpha Stabilization & Testing) ────── depends on Phase 10 & 14

[POST-ALPHA]
Phase 12 (Recording Storage) ────────────────── depends on Phase 11
Phase 13 (Admin Dashboard + Pagination) ─────── depends on Phase 11
Phase 14 (Multi-Location Expansion) ─────────── depends on Phase 11
Phase 15 (Scalability & Caching) ────────────── depends on Phase 11
```

## Estimated Timeline

| Phase | Name | Est. Duration | Depends On |
|-------|------|:------------:|:----------:|
| 8.5 | Pre-Migration Hardening | 1 week | — |
| 8.6 | Technical Debt & Refactoring | 1 week | Phase 8.5 |
| 9A | Schema, Locations & Roles (expanded) | 2 weeks | Phase 8.6 |
| 9B | Telnyx Provisioning & Agent Cloning | 2 weeks | 9A |
| 9C | Invitation & Onboarding | 1.5 weeks | 9B |
| 10 | Observability, Audit & Recovery | 1 week | 9C |
| 14 | E2E Provisioning Testing | 1 week | 10 |
| **11** | **Alpha Stabilization & Testing** | **2 weeks** | **14** |
| 12 | (Post-Alpha) Recording Storage | 2 weeks | 11 |
| 13 | (Post-Alpha) Admin Dashboard & Health | 2 weeks | 11 |
| 14 | (Post-Alpha) Multi-Location Expansion | Ongoing | 11 |
| 15 | (Post-Alpha) Scalability & Caching | 1.5 weeks | 11 |


