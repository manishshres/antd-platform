# AetherCall AI Call Center - SaaS Backend

This repository hosts the modular NestJS backend application for the Call Center AI platform, handling authentication, subscription billing, voice agent configurations, website parsing, and real-time MQTT kitchen printing.

---

## Technical Stack

- **Core Framework**: NestJS (v11+) & TypeScript
- **Database & ORM**: PostgreSQL with Drizzle ORM (node-postgres `pg` connection pooling)
- **Authentication**: JWT Access Token + DB-stored SHA-256 Hashed Refresh Tokens & Passport strategies
- **Validation**: Strict validation pipes via `class-validator` & `class-transformer`
- **Documentation**: Swagger API docs via `@nestjs/swagger`
- **Message Broker & Printers**: MQTT (Eclipse Mosquitto / EMQX)
- **Task Queues**: BullMQ & Redis

---

## Getting Started

### 1. Requirements

Ensure you have `Node.js (v24+)` and `npm` installed. For local PostgreSQL, Redis, and MQTT dependencies, Docker Desktop is recommended.

### 2. Environment Configuration

Create a `.env` file in the root of the project with the following properties (see `.env.example` for details):

```env
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgres://postgres:postgres@localhost:5432/antd_db

# Authentication
JWT_SECRET=your-jwt-access-secret-key
JWT_EXPIRATION=3600
JWT_REFRESH_SECRET=your-jwt-refresh-secret-key
JWT_REFRESH_EXPIRATION=604800

# Voice AI & Carrier (Telnyx)
TELNYX_API_KEY=your-telnyx-api-key
TELNYX_BASE_URL=https://api.telnyx.com/v2

# Stripe Billing
STRIPE_API_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret-key

# MQTT Broker (Printer Commands)
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=test
MQTT_PASSWORD=test

# Redis Connection (BullMQ Task Queues)
REDIS_URL=redis://localhost:6379
```

### 3. Local Infrastructure (PostgreSQL, Redis & MQTT)

If Docker is installed and running, spin up the local services:

```bash
docker compose up -d
```

### 4. Database Schema & Migrations

Manage schema synchronization using Drizzle:

```bash
# Push schema updates directly (recommended for local dev)
npx drizzle-kit push

# Generate migration files
npx drizzle-kit generate

# Run pending migrations
npx drizzle-kit migrate

# Open interactive Drizzle Studio database viewer
npx drizzle-kit studio
```

### 5. Running the Backend

```bash
# Install dependencies
npm install

# Build the TypeScript project
npm run build

# Start the development server (with hot reload)
npm run dev

# Start in production mode
npm run start:prod
```

### 6. Code Verification

```bash
# Run ESLint validation checks & auto-fixes
npm run lint

# Run Jest unit tests
npm run test
```

---

## Directory Layout

```text
drizzle/              # Generated Drizzle migration files
src/
  auth/               # Passport.js + JWT authentication, refresh token rotation, login security
  database/           # Drizzle connection pooling providers and SQL schemas (schema.ts)
  users/              # User data services
  common/             # Shared filters, interceptors, guards, decorators, and audit service
  health/             # Health check endpoints for DB, Redis, MQTT, and system metrics
  menus/              # Menu management, website crawling, and Gemini AI menu extraction
  orders/             # Customer order CRUD and manual/auto ticket printing
  printers/           # MQTT publisher and print job history trackers
  queues/             # BullMQ task queues configuration (print, import, and webhook tasks)
  stripe/             # Stripe payment gateway integrations and webhook verification
  telnyx/             # Client proxy for the Telnyx API
  app.controller.ts   # Base controller
  app.module.ts       # Main application module
  main.ts             # App bootstrapping (Prefix, helmet, CORS, GlobalFilters/Interceptors)
test/                 # End-to-end (e2e) tests
docker-compose.yml    # Dev PostgreSQL, Redis, and MQTT broker setup
mosquitto.conf        # Mosquitto MQTT configuration
```

---

## API Documentation

Interactive API documentation via Swagger is served locally at:
👉 **[http://localhost:4000/api/docs](http://localhost:4000/api/docs)**

---

## Troubleshooting

### MQTT Printing
1. **Unreachable Broker**: If print commands are not outputting to logs, verify Mosquitto is running in docker (`docker compose ps`). The backend stores jobs in an offline queue (up to 200) when the broker is down, and flushes them upon successful reconnection.
2. **Printer Authentication**: Ensure the MQTT username/password in `.env` match the configurations in `mosquitto.passwd`.

### BullMQ & Redis
1. **Connection Errors**: BullMQ requires Redis to be active. If Redis goes down, NestJS will log reconnection failures. Ensure Redis container is healthy.
2. **Stuck Jobs**: You can check queue statuses or active workloads via custom metrics endpoints or Drizzle Studio (`print_jobs` table).

### Webhook Signatures
1. **Invalid Stripe Signatures**: Ensure `STRIPE_WEBHOOK_SECRET` matches exactly the secret from the Stripe CLI (`stripe listen --forward-to localhost:4000/api/v1/stripe/webhook`).



No, you do not need to set up SIP connections separately when using the Telnyx AI Voice Assistant. The platform provides a one-click telephony integration, so SIP configuration is handled automatically.

**Requirements for AI Voice Assistant:**
- **Telnyx Account**: Sign up for a Telnyx account to access Voice AI features.
- **API Access**: Use Telnyx's APIs or the AI Assistant Builder for defining behavior.
- **Voice AI Agents**: Deploy AI agents on Telnyx's network with ultra-low latency.

**Setup Steps:**
1. **Sign Up**: Create a Telnyx account.
2. **Define Behavior**: Use the AI Assistant Builder (no-code interface) to define your AI agent's behavior with natural-language instructions.
3. **Test Agents**: Use the in-browser simulator to test before deployment.
4. **Deploy**: Deploy your AI agents through the Mission Control Portal.
5. **Integrate Tools**: Use built-in tools like dynamic variables, call transfers, and CRM updates.
6. **Choose Models**: Bring your own AI models or use Telnyx's open-source models.

**Additional Features:**
- Noise suppression (enabled by default).
- Multi-agent handoffs.
- HD Voice support with wideband codecs.

For more details, visit the [Voice AI Agents product page](https://telnyx.com/products/voice-ai-agents).