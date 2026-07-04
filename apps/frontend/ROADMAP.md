# SaaS Platform Roadmap — antd-demo (Next.js Frontend)

This roadmap tracks all frontend development phases for the Call Center AI SaaS Platform. It is fully synchronized with the `antd-backend` REST API.

> **Status Key**: ✅ Complete · 🔄 In Progress · 📋 Planned · 🔮 Future

---

## ✅ Phase 1 — Backend Migration Alignment

- [x] Remove all Next.js API route handlers (`app/api/*` — legacy Telnyx proxy)
- [x] Create unified `api.ts` Axios client with JWT interceptors
- [x] Configure `/api/v1/*` → `:4000` rewrite in `next.config.ts`
- [x] Define TypeScript DTOs in `src/types/` mirroring backend shapes
- [x] Delete legacy `src/lib/telnyx.ts` and `src/lib/security.ts`

---

## ✅ Phase 2 — Authentication & Route Protection

- [x] `/login` — JWT login form → `POST /auth/login`
- [x] `/register` — Registration form → `POST /auth/register` (Note: Backend registration may be disabled in favor of invitations)
- [x] Auth guard in `DashboardLayout.tsx` — redirect to `/login` if no token
- [x] Auth pages bypass sidebar layout
- [x] JWT stored and auto-attached via Axios interceptor

---

## ✅ Phase 3 — Core Dashboard Pages

- [x] `/assistant` — Voice AI agent list
- [x] `/assistant/[id]` — Agent detail + configuration editor
- [x] `/calls` — Call history table with filters
- [x] `/calls/[id]` — Call detail: wavesurfer.js waveform + transcript + metadata
- [x] `/documentation` — Knowledge base / document management
- [x] `/menus` — Category tabs + menu items + "Import from Website" flow
- [x] `/orders` — Order list + status management + mock order generator
- [x] `/billing` — Plan summary, usage meters, Stripe checkout + portal redirect

---

## 🔄 Phase 4 — Auth Completeness & Role System

- [x] `/forgot-password` — form → `POST /auth/forgot-password`, show confirmation
- [x] `/reset-password?token=xxx` — form → `POST /auth/reset-password`
- [x] `/verify-email?token=xxx` — page that calls `POST /auth/verify-email`
- [x] `/invite/validate?token=xxx` — page to validate organization invitation and accept
- [x] "Remember me" checkbox on login form (passes flag to backend to extend refresh token to 30 days)
- [x] Account lockout UX: show locked message with countdown timer after 5 failed attempts
- [x] Session timeout: auto-logout and redirect to login after inactivity
- [x] **Role Guards (UI):** Conditionally render UI elements based on backend role hierarchy (`platform_admin` > `sysadmin` > `manager` > `viewer`).
- [x] `/users` (org-admin only) — User management table:
  - Create, edit, disable, delete users
  - Assign roles to users
  - View last login activity

---

## 📋 Phase 5 — Multi-Tenant Architecture & Location Switching

- [x] **Global Location Selector:** Add a dropdown in the global TopNav/Sidebar to switch between operational Locations within an Organization.
- [x] **Location Scoping:** Ensure all data fetching (Orders, Menus, Printers, Calls, Agents) passes the selected `?locationId=xxx` query parameter to the backend.
- [x] **Organization Settings:**
  - View Organization profile (name, logo, timezone).
  - Manage overall organization subscription/billing.
- [x] **Location Management:** 
  - Add/Edit locations within the organization.
  - Assign managers to specific locations.

---

## ✅ Phase 6 — Organization Provisioning (Platform Admin Only)

- [x] `/admin/provisioning` — Dashboard for `platform_admin` to view all organizations.
- [x] **Create Organization Flow:** UI to trigger the backend provisioning pipeline (creates org, purchases Telnyx phone number, clones master AI agent).
- [x] **Provisioning Status Polling:** Real-time progress bar/status polling (`draft` -> `provisioning` -> `active`) reading from `GET /api/v1/admin/organizations/:id/provisioning-status`.
- [x] **Manual Intervention:** UI buttons to retry failed provisioning steps or deprovision an organization.

---

## ✅ Phase 7 — Webhooks & Developer Settings

- [x] `/settings/developer` — Webhook and API Key management dashboard.
- [x] **API Keys:** UI to generate and view the `webhookApiKey` used for AI order ingestion (Key is only shown once due to SHA-256 backend hashing).
- [x] **Outbound Webhooks:** UI to register destination URLs to receive order state changes and call events from the backend (Phase 14 backend).
- [x] Audit log view for outbound webhook delivery success/failures.

---

## ✅ Phase 8 — Printer Management Dashboard

- [x] `/printers` — Printer registry scoped by Location.
  - Register a new printer (name, topic, notes).
  - Real-time heartbeat status (polls `lastHeartbeatAt` and `isOnline`).
  - `isOnline` indicator with color badge.
- [x] **Printer Detail Page:**
  - Send test print job (`POST /printers/:id/test-print`).
  - View print queue history and dead-letter queue.
  - View failed print jobs with error reason.
  - Reprint a failed job.
  - Send restart command via MQTT control topic.

---

## ✅ Phase 9 — Audit & Activity Logs

- [x] `/audit` — Global audit log for the organization.
  - Table showing `userId`, `action`, `entityType`, `entityId`, `timestamp`.
  - Filters by date range, user, or entity.
- [x] Record audit entries for:
  - Menu changes
  - Printer configuration changes
  - User role changes
  - API Key rotation
  - Webhook delivery failures

---

## ✅ Phase 10 — Menu Management Enhancements

- [x] Menu item image upload (via backend proxy to object storage).
- [x] Modifier / add-on / variant support per menu item (UI for `menu_modifiers` table).
- [x] Availability schedules per item (days + time windows).
- [x] Soft delete support (restore deleted items).
- [x] Category and item drag-and-drop reordering (updating `sortOrder`).

---

## ✅ Phase 11 — Real-Time Features

- [x] **WebSocket Connection**: Connect via `socket.io-client` on app mount.
- [x] Live order status updates: orders list auto-updates when backend pushes an event.
- [x] Toast / notification push on new order received (browser Notification API).
- [x] Connection status indicator in the header (green dot = connected, red = reconnecting).

---

## ✅ Phase 12 — Admin Dashboard, Analytics & Reporting

### Dashboard Overview
- [x] `/dashboard` redesign:
  - KPI cards: total orders today, revenue, active calls, printer status.
  - Line charts: orders over time, call volume trends.
  - Live operational snapshot section (active calls, queue depths).

### Tenant Usage & Billing
- [x] `/analytics/usage` — monthly usage vs plan limits.
- [x] `/billing/history` — invoice history list with download buttons.
- [x] `/billing/breakdown` — usage breakdown by location.

### Operational Dashboard (Platform Admin)
- [x] `/admin/health` — System health dashboard:
  - SIP trunk status (Telnyx)
  - MQTT broker connection status
  - Background job queue depths (BullMQ)
  - Redis health
- [x] Real-time status badges with last-checked timestamps.

---

## ✅ Phase 13 — Recording & Conversation Storage

- [x] `/calls/[id]` enhancements:
  - Download recording button (maps to backend signed URL from Cloudflare R2).
  - Full transcript display with speaker attribution.
  - AI-generated summary panel (`aiSummary` from DB).
  - Sentiment score badge (`positive`, `negative`, `neutral`).
  - Tags and call outcome classification.
- [x] **Recording Search:** Full-text search across transcripts (`?search=` param).
- [x] **Export:** Download transcript as CSV/PDF using backend export endpoints.

---

## ✅ Phase 14 — Multi-Location Expansion & Platform Toggles (Frontend Sync)

- [x] **Platform Admin Location Provisioning:** Add UI in `/admin/provisioning` or Organization details to trigger `POST /admin/organizations/:id/locations` (provisions Telnyx number & AI Agent for the new location).
- [x] **Location Manager Assignment:** Add UI in `/settings` (Locations tab) or `/users` to assign a manager to a specific location (`POST /locations/:id/assign-manager`).
- [x] **Feature Flags Management:** Add a UI section for Platform Admins to toggle JSONB feature flags on an Organization.

---

## 📋 Phase 15 — Scalability & Caching (Frontend Sync)

- [x] No frontend UI required (Caching and Idempotency handled purely in backend).
