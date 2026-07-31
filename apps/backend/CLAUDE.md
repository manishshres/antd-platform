# CLAUDE.md — antd-backend (NestJS SaaS API)

This file provides comprehensive guidance for AI coding assistants and human developers working on the `antd-backend` project.

> **@AGENTS.md** — see `AGENTS.md` for quick-reference rules.

---

## 🧠 System Overview

This backend is the **single source of truth** for the Call Center AI SaaS Platform. It is a modular NestJS API that:

- Serves the Next.js frontend (`antd-demo`) and any future mobile or external clients.
- Owns all business logic, authentication, authorization, and data access.
- Manages background processing (print queues, email, imports, webhook ingestion) via BullMQ.
- Integrates with Stripe (billing), Telnyx (voice AI), MQTT (printing), and Google Gemini (AI extraction).

**The frontend is a dumb UI layer. This backend drives everything.**

---

## 🧱 Technology Stack

| Layer           | Technology                              | Notes                                        |
| --------------- | --------------------------------------- | -------------------------------------------- |
| Framework       | NestJS 11+ (TypeScript)                 | Modular architecture                         |
| Database        | PostgreSQL (Neon serverless in prod)    | All tables defined in `schema.ts`            |
| ORM             | Drizzle ORM + Drizzle Kit               | Strict typing, no raw SQL                    |
| Background Jobs | BullMQ + Redis                          | Queues: print, email, imports, webhook       |
| Message Broker  | Eclipse Mosquitto (MQTT v5)             | Kitchen/receipt printing                     |
| MQTT Client     | Eclipse Paho / MQTT.js                  | Subscribe + publish within NestJS            |
| Auth            | Passport.js + JWT                       | Access + SHA-256 Hashed Refresh tokens       |
| Billing         | Stripe SDK                              | Checkout, portal, webhooks                   |
| Voice AI        | Telnyx API                              | Assistants, call logs, recordings            |
| AI Extraction   | Google Gemini API                       | Menu import from websites                    |
| File Storage    | Cloudflare R2 (S3-compatible)           | Recordings, document uploads                 |
| Docs            | Swagger / OpenAPI (`@nestjs/swagger`)   | `/api/docs` — **non-production only**, disabled when `NODE_ENV=production` |
| Validation      | `class-validator` + `class-transformer` | On all DTOs                                  |
| Config          | `@nestjs/config` (`ConfigService`)      | Typed env access — no `process.env` directly |
| Security        | Helmet.js                               | Secure HTTP headers                          |

---

## 📁 Project Structure

```
antd-backend/
├── src/
│   ├── main.ts                      # Bootstrap: Swagger, ValidationPipe, CORS, helmet, Filters/Interceptors
│   ├── app.module.ts                # Root module — imports all feature modules
│   ├── database/
│   │   ├── schema.ts                # ← ALL table definitions live here
│   │   ├── database.module.ts       # DrizzleModule + connection provider
│   │   └── db.provider.ts
│   ├── auth/
│   │   ├── auth.controller.ts       # /api/v1/auth/*
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── dto/                     # LoginDto, RegisterDto, RefreshDto, etc.
│   │   ├── guards/                  # JwtAuthGuard, RolesGuard
│   │   ├── decorators/              # @Roles()
│   │   └── strategies/              # JwtStrategy
│   ├── users/
│   │   ├── users.controller.ts      # /api/v1/users/*
│   │   ├── users.service.ts
│   │   └── users.module.ts
│   ├── common/                      # Shared resources across modules
│   │   ├── decorators/              # @CurrentUser(), @Public(), @Roles()
│   │   ├── filters/                 # GlobalExceptionFilter
│   │   ├── interceptors/            # LoggingInterceptor
│   │   ├── guards/                  # PlanLimitGuard
│   │   └── services/                # AuditService
│   ├── health/                      # Health checks & Metrics endpoints
│   ├── agents/                      # Voice AI agent configuration (Telnyx proxy & org scope)
│   ├── calls/                       # Call logs, recording proxy, transcripts
│   ├── menus/                       # Menu CRUD, crawler, Gemini extractor, and import task queue
│   ├── orders/                      # Customer order CRUD, POS/AI order creation, payments, refunds, transaction summary
│   ├── tables/                      # Floor plans & tables CRUD; live table status derived from each table's active order
│   ├── printers/                    # MQTT printing logic, print jobs, configurations, and worker queue
│   ├── queues/                      # Global BullMQ configuration & queues initialization
│   ├── stripe/                      # Stripe webhook handler & client provider
│   ├── billing/                     # Stripe checkout portals, subscription management, API keys
│   └── documents/                   # File uploads, security scanning, and R2 integrations
├── drizzle/                         # Generated migration files
├── drizzle.config.ts
├── docker-compose.yml               # Postgres + Redis + Mosquitto (local dev)
├── .env                             # Local secrets (never commit)
├── .env.example                     # Committed — lists all required configuration keys
├── AGENTS.md
├── CLAUDE.md
└── ROADMAP.md
```

---

## 🔐 Authentication & Authorization

### Auth Flow

```
POST /api/v1/auth/register       → creates user, returns tokens
POST /api/v1/auth/login          → validates credentials, returns tokens
POST /api/v1/auth/refresh        → rotates refresh token (deletes old one)
POST /api/v1/auth/logout         → revokes refresh token from DB
GET  /api/v1/auth/me             → returns current user profile (via @CurrentUser())
```

### JWT Strategy

- **Access Token**: Short-lived (15 min). Sent in `Authorization: Bearer <token>` header. Contains `sub` (userId), `email`, `role`, and `organizationId`.
- **Refresh Token**: Stored (SHA-256 hashed) in the `refresh_tokens` table for rotation/revocation.
  - Default TTL is **24 hours**; login with `rememberMe: true` gets **30 days** (`REFRESH_TTL_DEFAULT` / `REFRESH_TTL_REMEMBER_ME` in `auth.service.ts`).
  - On refresh, the **original token's TTL is preserved** across rotation — a rememberMe session keeps its 30-day lifetime through every subsequent refresh, it doesn't collapse to the 24h default.

### Frontend Token Refresh

The frontend (`apps/frontend/src/lib/api.ts`) proactively refreshes the access token ~5 minutes before it expires (decodes the JWT `exp` client-side, schedules a timer), so users rarely hit a reactive 401. The 401-triggered refresh-and-retry in the response interceptor remains as a safety net for cases the proactive timer misses (e.g. laptop sleep).

### Decorators & Guards

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
```

Use `@Public()` to bypass `JwtAuthGuard` checks for public paths. Expose current user context using `@CurrentUser() user: CurrentUserPayload`.

---

## 📦 Database & Drizzle ORM

### Rules

1. **ALL** table definitions go in `src/database/schema.ts`. Never create tables elsewhere.
2. **Never** write raw SQL strings. Use Drizzle query builders.
3. **Always** apply changes locally via `npx drizzle-kit push` or generate migrations with `npx drizzle-kit generate` + `npx drizzle-kit migrate`.
   - `drizzle-orm` and `pg` are also declared in the **root** `package.json` devDependencies.
     That is deliberate, not a stray duplicate: npm hoists `drizzle-kit` to the root, and
     drizzle-kit resolves `drizzle-orm/version` relative to its own location, so without a
     root-level copy every command dies with the misleading *"Please install latest version
     of drizzle-orm"*. `pg` has to come along because `drizzle-orm/node-postgres` requires
     it as a peer from wherever drizzle-orm ends up. **Keep all four version ranges in step
     with `apps/backend/package.json`, and don't delete them.**
   - Journal `idx` must equal the numeric prefix of the migration's `tag`, and every `.sql`
     file needs an entry in `drizzle/meta/_journal.json` — a file with no entry is silently
     never applied by `migrate`, and it shifts every later tag out of alignment.
   - **Pre-commit validation**: When you commit changes to migrations or `schema.ts`, husky hooks
     automatically validate that:
     - Every `.sql` migration file has a corresponding journal entry with matching `idx`
     - The Drizzle snapshot (`0NNN_snapshot.json`) is in sync with `schema.ts` (regenerated if needed)
     
     If validation fails, fix it by running:
     ```bash
     npx drizzle-kit generate
     ```
     then re-stage and commit. If the pre-commit hook doesn't run, manually validate:
     ```bash
     node scripts/validate-migrations.mjs
     node scripts/validate-drizzle-snapshot.mjs
     ```
4. **Soft deletes**: Add `deletedAt` timestamp column to schemas requiring soft deletes. Filter using `isNull(table.deletedAt)`.
5. **No JS Filtering**: Use `inArray` to query items inside categories. Never pull all rows and filter using `Array.prototype.filter` in JS memory.

### Idempotency Keys

For endpoints a client might retry (e.g. POS creating an order while offline, then resyncing), accept an optional client-supplied idempotency key, check for an existing row before inserting, and back it with a **unique constraint** so a race between the check and the insert still can't create a duplicate. See `orders.clientOrderId` (unique per `organizationId`, migration `0014`) and `OrdersService.createPosOrder` for the reference implementation.

---

## ⚙️ Background Jobs & Queues (BullMQ)

Heavy operations are offloaded to BullMQ queues:
- `print-queue`: Dispatches MQTT print tasks (Retry: 3 attempts, exponential backoff).
- `import-queue`: Website menu crawling and AI extraction tasks.
- `webhook-queue`: AI order ingestion pipeline (QoS verification).

Feature-specific processors are declared inside the feature modules (`ImportQueueProcessor` in `menus`, `PrintQueueProcessor` in `printers`, `WebhookQueueProcessor` in `webhooks`).

---

## 🖨️ MQTT Printer System

MQTT commands are published using QoS 2:
- `restaurant/{orgId}/kitchen/print`
- `restaurant/{orgId}/receipt/print`

heartbeats are monitored for offline status detection. Default topics are persisted per organization.

---

## 🌐 Telnyx White-Labeling Boundary

To hide Telnyx carrier branding:
- All controller routes must map raw Telnyx responses to neutral, provider-agnostic DTOs (e.g. `recordingUrl` instead of `download_urls.wav`, `durationMs` instead of `duration_millis`).
- Database mapping tables (`org_agents`, `org_documents`, `org_phone_numbers`) are used to enforce strict tenant isolation, mapping external Telnyx IDs to organizations.

---

## 🚀 Bootstrap & CI

- `DatabaseModule.onApplicationBootstrap()` seeds default plans and, **only when `NODE_ENV` is not `production`**, a default admin user (`test@example.com`). A fresh production database must have its first admin provisioned through a secure, explicit step — never via this dev convenience seed.
- Swagger (`/api/docs`) is likewise mounted only outside production (see `main.ts`).
- `.github/workflows/ci.yml` runs on every push to `main`/`master` and on PRs: backend `build` + `test` and frontend `tsc --noEmit` are **gating**; lint runs but is currently `continue-on-error: true` because of pre-existing lint debt across the repo. Run `npm run lint` locally anyway before finishing — don't let the informational CI status be a reason to skip it. Once the workspaces are lint-clean, flip lint to a hard gate.

---

## 🛑 Common Anti-Patterns to Avoid

| ❌ Don't                                    | ✅ Do Instead                                 |
| ------------------------------------------- | --------------------------------------------- |
| `process.env.JWT_SECRET` directly           | `this.configService.get('JWT_SECRET')`        |
| Raw SQL strings                             | Drizzle query builder                         |
| Business logic in controllers               | Move to service layer                         |
| Ad-hoc debug code (`fs.appendFileSync`, stray `console.log`) left in a handler | Use the NestJS `Logger`; remove scratch debugging before committing |
| Synchronous blocking operations             | Use BullMQ queues for heavy tasks             |
| Plaintext refresh tokens                    | Save SHA-256 hashes of refresh tokens         |
| Returning raw Telnyx structures             | Map to clean DTOs (white-labeling)            |
| `console.log()` for logging                 | Use NestJS `Logger`                           |
| Catching and swallowing errors silently     | Normalise via `GlobalExceptionFilter`         |
| Any `any` type                              | Explicit types or cast via interfaces         |
| JS array filter for DB queries              | Drizzle `inArray` or explicit query conditions|
