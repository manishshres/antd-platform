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
| Docs            | Swagger / OpenAPI (`@nestjs/swagger`)   | Available at `/api/docs`                     |
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
│   ├── orders/                      # Customer order CRUD & manual/auto printing
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
- **Refresh Token**: Long-lived (7 days). Stored (SHA-256 hashed) in the `refresh_tokens` table for rotation/revocation. On refresh, the old token is invalidated and a new one is returned.

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
4. **Soft deletes**: Add `deletedAt` timestamp column to schemas requiring soft deletes. Filter using `isNull(table.deletedAt)`.
5. **No JS Filtering**: Use `inArray` to query items inside categories. Never pull all rows and filter using `Array.prototype.filter` in JS memory.

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

## 🛑 Common Anti-Patterns to Avoid

| ❌ Don't                                    | ✅ Do Instead                                 |
| ------------------------------------------- | --------------------------------------------- |
| `process.env.JWT_SECRET` directly           | `this.configService.get('JWT_SECRET')`        |
| Raw SQL strings                             | Drizzle query builder                         |
| Business logic in controllers               | Move to service layer                         |
| Synchronous blocking operations             | Use BullMQ queues for heavy tasks             |
| Plaintext refresh tokens                    | Save SHA-256 hashes of refresh tokens         |
| Returning raw Telnyx structures             | Map to clean DTOs (white-labeling)            |
| `console.log()` for logging                 | Use NestJS `Logger`                           |
| Catching and swallowing errors silently     | Normalise via `GlobalExceptionFilter`         |
| Any `any` type                              | Explicit types or cast via interfaces         |
| JS array filter for DB queries              | Drizzle `inArray` or explicit query conditions|
