# Engineering Review — Restaurant Management Platform (antd-platform)

**Date:** 2026-07-06 · **Reviewer:** full-codebase audit pass
**Scope:** entire monorepo (backend 221 TS files, frontend 62 TS/TSX files, shared-types package)
**Companion docs:** `AUDIT_FIX_TRACKER.md` (51/51 security/correctness fixes, 2026-07-04),
`apps/backend/ROADMAP.md` (phases 1–15, all shipped), `docs/POS_IMPLEMENTATION_PLAN.md` (POS spec, P0/P1 mostly shipped).

This review does **not** repeat the 2026-07-04 audit — that work is done and verified. It
(1) records the current architecture, (2) reports **new findings** from this pass, and
(3) maps the gap between what exists (Call-Center-AI SaaS + POS) and the stated goal
(full Restaurant Management Platform), with a phased roadmap and backlog.

---

## 1. Architecture Overview

**What this system actually is today:** a multi-tenant SaaS where restaurants get an
AI voice agent (Telnyx) that answers the phone and takes orders, which flow into a
dashboard, kitchen/receipt printers (MQTT), and — as of the last five commits — a real
counter-service POS register with split payments.

```
                         ┌────────────────────────────────────────────┐
 Caller ──► Telnyx AI ──►│  NestJS API (apps/backend, :4000/api/v1)   │◄── Next.js 16 dashboard+POS
            (per-location│  40 modules · global JWT+Roles guards      │    (apps/frontend, :3000)
             cloned agent)│  Drizzle ORM ─► PostgreSQL (Neon in prod) │◄── Public API v2 (API keys)
 Webhooks (signed) ──────►│  BullMQ ─► Redis (print/import/webhook/   │
 Stripe webhooks ────────►│            provisioning/outbound queues)  │──► MQTT (Mosquitto) ─► ESC/POS printers
                          │  Socket.IO events gateway                 │──► Stripe (subscriptions)
                          │  Cloudflare R2 (recordings, documents)    │──► Gemini (menu extraction)
                          └────────────────────────────────────────────┘
```

**Tenancy model:** `organizations` → `locations` (operational boundary: menu, phone number,
AI agent, printers, orders, subscription are per-location). Roles: `platform_admin` (global),
`sysadmin` (org), `manager` (location). Invitation-only registration; automated Telnyx
provisioning pipeline with step tracking and retry.

**Verdict:** the architecture is sound and unusually well-hardened for its stage
(global auth guards, signed webhooks, hashed tokens/keys, tenant-scoped queries, idempotency
tables, outbound webhook HMAC, OTel/Sentry/Prometheus, env validation). The codebase is a
solid foundation to grow into the full restaurant platform. The gap is **breadth of features**,
not quality of the core.

## 2. Technology Stack (verified against package.json / code)

| Layer | Tech | Assessment |
|---|---|---|
| API | NestJS 11, TS strict | Good. 40 feature modules, consistent controller/service/dto layout |
| DB | PostgreSQL + Drizzle ORM | Good. Single `schema.ts`, 32 tables, CHECK constraints, composite indexes, soft deletes |
| Jobs | BullMQ + Redis | Good. Retry/backoff, DLQ for print jobs |
| Realtime | Socket.IO gateway | OK. CORS restricted (M9) |
| Printing | MQTT (Mosquitto) QoS2 + ESC/POS | Good. Heartbeats, LWT, offline sweep, event-matrix print policy |
| Billing | Stripe subscriptions + webhooks | Good for SaaS billing. **No customer payment processing** (POS card = record-only) |
| Voice AI | Telnyx (white-labeled) | Good. Ed25519-verified webhooks, per-org resource mapping |
| AI extraction | Gemini + Firecrawl/Cheerio | Works; lint debt concentrated here |
| Frontend | Next.js 16 App Router, AntD 6, React 19 | Good. Middleware auth, HttpOnly refresh cookie |
| Observability | pino, Sentry, OTel, Prometheus | Present and wired |
| Docs | Swagger at `/api/docs` | Present |

Dependency review: versions are current (Nest 11, Next 16, Stripe 22, Drizzle 0.45). No
abandoned or risky deps spotted. `json2csv` is on an alpha tag — pin or replace eventually (Low).

## 3. New Findings (this pass — not in the previous audit)

### Critical

**N1 — Orders can never reach `completed`: state machine vs DB CHECK mismatch.**
`orders.service.ts:1206` allows `ready → completed`, and `'completed'` is written to the DB —
but the CHECK constraint (`schema.ts:448`, migration `0001`) permits
`('pending','confirmed','preparing','ready','delivered','cancelled')`. Setting `completed`
violates `orders_status_check` → Postgres error → 500. Either the constraint says `delivered`
and code says `completed`, or vice versa; today they disagree. Fix: pick `completed`
(matches code, UI, analytics), migrate the constraint, and map any legacy `delivered` rows.
*Needs a runtime repro to confirm the live DB matches the migration — but schema.ts and the
transition map disagree on their face.*

**N2 — Uncommitted, untested work-in-progress sitting on `master`’s working tree.**
The refund/void flow (full + partial), order-item adjustment, POS PIN (`setPosPin` /
`verifyManagerPin`), order-details page, and a schema change (`pos_pin_hash`, payments CHECK
relaxed to `!= 0`) plus migration `0010` are all uncommitted. Also untracked: `patch.js`,
`patch2.js`, `patch_pos.js` (ad-hoc code-mutation scripts — a dangerous editing pattern; the
edits are already applied, delete them) and `url.txt` (a signed R2 recording URL — delete).
Risk: this is exactly the state the previous audit's C7 warned about. Finish, test, commit.

### High

**N3 — Manager PIN is brute-forceable and org-ambiguous.**
`verifyManagerPin` bcrypt-compares the submitted PIN against **every** manager in the org:
(a) no throttle/lockout on the refund endpoint's PIN parameter — a 4-digit PIN is 10k
guesses against an authenticated-but-junior session; (b) two managers with the same PIN
silently resolve to whichever row comes first — audit attribution can be wrong; (c) O(n)
bcrypt comparisons block the event loop as staff count grows. Fix: enforce PIN uniqueness
per org at set time, add attempt throttling + audit on failure, and consider requiring the
manager's identity (user picker + PIN) rather than PIN-only.

**N4 — Refunds are financial records only; no processor integration and no drawer impact model.**
Negative `payments` rows are correct bookkeeping, but "card" refunds don't refund anything
(acceptable while card = external terminal — must be stated in the UI), and there's no cash
drawer session for the cash to come out of. Fine for now; becomes wrong the moment Stripe
Terminal or drawer management (POS plan P2/P3) lands. Track as an explicit constraint.

**N5 — Still no remote, CI, or rotated secrets** (carried from C7, still open).
`git remote -v` is empty; a disk failure loses the repo and its history. `.env` secrets that
predate git remain unrotated. `postgres_data/` (live DB cluster) and `coverage/` live inside
the repo dir (ignored, but they don't belong there — move DB data out of the source tree).
This is the single highest-leverage infra task: remote + CI gate (`lint`, `build`, `test`) + secret rotation.

### Medium

- **N6 — `ticketNumber` has no uniqueness guarantee.** Per-location daily sequence is computed
  in code; concurrent order creation can mint duplicate ticket numbers. Add a per-location
  counter table or a unique partial index + retry.
- **N7 — Payments CHECK `method IN ('cash','card')`** will need migration for gift cards /
  store credit / split-tender types on the roadmap; plan the enum expansion once, not per feature.
- **N8 — No `currency` column anywhere.** All money is integer cents (good) but USD-implicit.
  Add `currency` to `locations` (display) before any customer-facing payment processing.
- **N9 — Backend lint debt (≈128 errors) + spec rot + Jest double-discovery of a stale
  compiled tree** (documented in AUDIT_FIX_TRACKER "New Architecture Concerns") still block a
  zero-warning CI gate. Fix jest `roots`, clean `dist/`, repair the 3 rotten suites.
- **N10 — PlanLimitGuard wired only on menu import.** Agent/phone-number provisioning
  endpoints still lack `@CheckLimit` (carried from C6 follow-up).
- **N11 — `users_role_check` allows 5 roles but the platform uses 3.** The POS needs a
  `cashier`-grade role (staff who can ring sales but not refund/void); today the lowest real
  role is `manager`, which is why PIN-gating had to be invented. An Employees epic should
  introduce `staff` properly.

### Low

- `apps/frontend/.git.backup-pre-monorepo/` and `.kiro/` are dead weight — archive outside the repo.
- Swagger title still says "Call Center AI Backend API"; frontend package renamed to
  `coneeko-frontend` but root workspace is `antd-platform` — settle branding once.
- `url.txt`, playwright-report, coverage output should be gitignored/removed.
- `orders.service.ts` is 1,585 lines and growing — split into `orders`, `payments`,
  `refunds` services before the Payments epic makes it worse.

## 4. Feature Inventory vs Product Goal

| Capability (goal) | Status today |
|---|---|
| Restaurant POS (counter service) | ✅ Shipped (register, totals engine, split pay, hold orders, ticket #s, PWA) |
| POS: refunds/voids + manager PIN | ✅ Shipped |
| POS: modifiers multi-select, quantity limits | ✅ Shipped |
| Kitchen printing / receipt printing | ✅ Shipped (MQTT, policy matrix, hold-until-paid) |
| Kitchen Display System | ❌ Not started (POS plan P2) |
| AI phone ordering | ✅ Shipped (the platform's origin story) |
| Online ordering website / guest checkout | ❌ Not started — no public storefront, no customer accounts |
| Customer portal / accounts / saved addresses / favorites | ❌ Not started (no `customers` table) |
| Payment processing (cards, wallets, tokenization) | ❌ Card = record-only; Stripe Terminal explicitly deferred |
| Gift cards / store credit | ❌ Not started |
| Discounts / promo codes | ✅ Basic (percent/fixed, code, manager-gated) — no usage limits/expiry/schedules |
| Inventory management | ❌ Not started |
| Employee management / shifts / time clock | ❌ Not started (users ≠ employees; no staff role — N11) |
| Cash drawer / EOD / Z-reports | ❌ Planned (POS plan P3) |
| Loyalty / rewards | ❌ Not started |
| Reporting & analytics | ✅ Dashboard KPIs, usage, margin; ❌ sales/EOD/inventory reports |
| Multi-location | ✅ Shipped (core architectural strength) |
| Franchise support (rollups, royalties) | ❌ Not started (org→location gets you 80% of the model) |
| Delivery integrations (DoorDash/UberEats/Grubhub) | ❌ Not started (inbound webhook infra + idempotency table are reusable) |
| Driver API | ❌ Not started |
| Mobile APIs | ⚠️ The REST API is mobile-consumable; no purpose-built customer/driver surfaces |
| API keys / public API / outbound webhooks / audit logs | ✅ Shipped |
| Auth, RBAC, multi-tenancy, billing, observability | ✅ Shipped and hardened |

## 5. Implementation Roadmap

Ordering principle: stabilize → finish the register → open the online channel (biggest
revenue unlock) → operational depth → integrations. Each phase leaves the platform shippable.

### Phase 0 — Stabilize & Land WIP (risk: low · complexity: S · ~1 week)
**Objective:** clean tree, green CI, no known correctness bugs.
- Fix N1 (status constraint migration + code alignment).
- Finish/test/commit the refund + PIN work (N2); harden PIN (N3: uniqueness, throttle, audit).
- Delete `patch*.js`, `url.txt`; relocate `postgres_data/`; prune `.git.backup-pre-monorepo`.
- Add git remote, CI (lint+build+test on PR), rotate pre-git secrets (N5).
- Fix Jest double-discovery, repair 3 rotten suites, burn down lint errors to 0 (N9).
- **DB changes:** `orders_status_check` migration; commit migration 0010.
- **Outcome:** trustworthy baseline; regressions detectable.

### Phase 1 — POS Completion (risk: low · complexity: M · ~2–3 weeks)
Per the existing POS plan (P1/P2 remainder): multi-select modifiers + quantity limits;
`staff` role + per-user PIN sign-in on shared register (N11); order history search/reprint/
duplicate; ticket-number race fix (N6).
**Outcome:** register is feature-complete for counter service.

### Phase 2 — Customers & Online Ordering (risk: medium · complexity: L · ~4–6 weeks)
The biggest missing pillar. New `customers`, `customer_addresses`, `carts` tables
(org-scoped, phone-first identity so AI-phone and POS orders link to the same person).
Public storefront (new Next.js route group or app: menu browse → cart → guest/account
checkout → order tracking page fed by existing Socket.IO events). Scheduled orders
(`orders.scheduledFor`). Stripe PaymentIntents for online card payment (tokenized, PCI-SAQ-A).
**API:** public, versioned `/api/v2/storefront/*` reusing the API-key + throttle infra.
**Outcome:** restaurants take commission-free online orders; customer identity exists for loyalty later.

### Phase 3 — Payments Maturity (risk: medium-high · complexity: L · ~3–4 weeks)
Stripe Terminal (card-present at register), real card refunds through the processor (closes
N4), gift cards + store credit (new `gift_cards`, `gift_card_transactions`; extend payments
method enum once — N7), tips on card, currency column (N8). Cash drawer sessions +
Z-reports (POS plan P3) belong here because refunds/tips must reconcile against a drawer.
**Outcome:** money handling is end-to-end real, reconcilable, and PCI-sane.

### Phase 4 — Kitchen & Operations (risk: low · complexity: M · ~3 weeks)
KDS screen (existing events gateway + print-job payloads are 90% of the data model);
inventory (ingredients, recipes/BOM, depletion on order, 86-ing items, counts, low-stock
alerts); employees (shifts, time clock, roles) building on the `staff` role.
**Outcome:** back-of-house runs on the platform.

### Phase 5 — Delivery Integrations (risk: high — external dependencies · complexity: L · ~4–6 weeks)
Provider-agnostic `delivery_integrations` layer: one internal order model, per-provider
adapters (DoorDash Marketplace, Uber Eats, Grubhub), webhook ingestion reusing the
`webhook_events` idempotency table + BullMQ retry, menu publishing per provider, status
sync back (accept/reject/ready/complete), refund pass-through where supported.
Requires provider developer-account research *before* implementation (their APIs and
onboarding differ materially; Uber Eats and DoorDash require app review).
**Outcome:** third-party orders appear and are managed in one dashboard.

### Phase 6 — Loyalty, Marketing & Franchise (risk: low · complexity: M · ongoing)
Points/rewards engine on the `customers` spine; promo-code enhancements (usage caps,
windows, channel restrictions); notification center (email/SMS hooks exist via
nodemailer/Telnyx); franchise rollup reporting (org-level dashboards across locations,
royalty exports).

**Dependency graph:** 0 → 1 → 2 → 3 → {4, 5, 6 in any order; 6 depends on 2's customers table}.

## 6. Backlog (Epic → Feature level)

| # | Epic | Key features | Priority | Depends on | Effort |
|---|---|---|---|---|---|
| E0 | Stabilization | N1 fix, land WIP, CI/CD, secret rotation, lint zero | **Critical** | — | 1 wk |
| E1 | POS completion | staff role+PINs, modifiers UX, history/reprint, ticket race | High | E0 | 2–3 wk |
| E2 | Customers | customers/addresses tables, phone-first identity merge | High | E0 | 1–2 wk |
| E3 | Online ordering | storefront, cart, guest checkout, PaymentIntents, tracking, scheduled orders | High | E2 | 3–4 wk |
| E4 | Payments | Stripe Terminal, real refunds, gift cards, drawer+Z-reports, currency | High | E1 | 3–4 wk |
| E5 | KDS | screen, bump/recall, station routing, prep timers | Medium | E1 | 1–2 wk |
| E6 | Inventory | ingredients, recipes, depletion, counts, alerts, reports | Medium | E1 | 3 wk |
| E7 | Employees | shifts, time clock, permissions matrix | Medium | E1 | 2 wk |
| E8 | Delivery | adapter layer, DoorDash, UberEats, Grubhub, menu publish, status sync | Medium | E3 | 4–6 wk |
| E9 | Loyalty & marketing | points, rewards, promo enhancements, notifications | Low | E2 | 2–3 wk |
| E10 | Franchise & reporting | rollups, royalty exports, EOD/sales report suite | Low | E4 | 2 wk |

Task-level breakdown lives per-epic; the POS plan (`docs/POS_IMPLEMENTATION_PLAN.md`)
already carries E1/E4/E5 detail and remains authoritative for those.

## 7. Standing Engineering Rules (unchanged, enforced)

Tenant-scope every query by JWT org; Drizzle only; DTO validation everywhere; heavy work to
BullMQ; audit-log state changes; secrets via ConfigService; zero-lint CI gate once N9 lands.
See `apps/backend/AGENTS.md`.
