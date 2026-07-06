# POS Engineering Specification

Toast/Square-class point of sale for restaurants, built into the existing platform
(NestJS backend + Next.js/AntD frontend). This document is the single source of truth
for what exists, what is being built, and how.

Last updated: 2026-07-06

---

## 1. Executive Summary

We are building an iPad-first POS register that shares one order pipeline with the
platform's AI phone-ordering system. A cashier rings an order in under 30 seconds;
an AI phone order lands in the same queue and is settled at the same register. Money
math is computed exclusively server-side. Printing, realtime updates, auth, and
multi-tenancy reuse existing platform infrastructure.

Counter-service MVP is **shipped** (register, tender flow, tips, discounts, cash
handling, AI-order handoff, print controls). The next milestones are the payments
table (split payments, cash-drawer reporting), manager PIN with voids/refunds, and
customer profiles.

## 2. Guiding Principles

1. **Speed over features.** Every interaction on the register path must feel
   instant; anything that slows ringing an order gets moved off the main screen
   (see the tender modal).
2. **The backend is the source of truth.** The client sends ids and quantities;
   prices, tax, discounts, and totals are computed and validated server-side.
3. **One pipeline for every channel.** POS, AI phone, and future online orders are
   rows in the same table, flow through the same printing/eventing, and appear in
   the same reports.
4. **History is immutable.** Prices and modifier selections are snapshotted onto
   order items at order time; menu edits never mutate past orders.
5. **Progressive disclosure.** Tip, discount, change-due, and payment method appear
   at tender time, not while building the cart.

## 3. Current Platform (reused, not rebuilt)

| Capability | Module | POS usage |
|---|---|---|
| Menu: categories, items, modifier groups/options, availability, favorites | `menus` | Register grid, picker, pricing inputs |
| Orders + order items with snapshots | `orders` | All channels write here |
| ESC/POS printing over MQTT (QoS 2, retries, DLQ) | `printers` | Kitchen tickets + receipts |
| Realtime WebSocket rooms per org + SSE | `events` | `order.created` / `order.updated` |
| JWT auth, role hierarchy, org/location scoping | `auth`, `common` | All endpoints; manager gating |
| Audit log | `common/AuditService` | Every state-changing action |
| Stripe SDK + webhooks (SaaS billing) | `stripe`, `billing` | Future: Stripe Terminal |
| AI phone orders via webhook pipeline | `webhooks` | Same orders table, `source='ai_phone'` |

## 4. Architecture Decisions

These explain *why* the system is shaped this way. They are settled.

- **AD-1 One orders table for all channels.** `orders.source` distinguishes
  `pos | ai_phone | online`. Dashboards, printing, analytics stay unified.
- **AD-2 Server-side totals engine.** Client sends `menuItemId + quantity +
  optionIds`; the service prices from the DB. Formula:
  `subtotal − discount = taxable base; + tax(taxable) ; + tip = total`.
  Discounts reduce the taxable base. Tax is a flat per-location rate in basis
  points (`locations.tax_rate_bps`) until a `tax_rates` table is needed.
- **AD-3 Price + modifier snapshots.** `order_items.price` (unit, incl. options)
  and `order_items.modifiers` (jsonb with `optionId`, names, adjustments) freeze
  the order at creation; `optionId` lets the register re-open and edit it.
- **AD-4 Unpaid orders are first-class.** `paidAt IS NULL` = editable, holdable,
  visible in Open Orders. AI phone orders arrive unpaid; POS "Save" creates them.
  Payment is a separate step (`/orders/:id/pay`). Paid orders are immutable until
  the void/refund path exists.
- **AD-5 Payments become a table (planned, defined once in §7).** One order → many
  partial payments unlocks split checks and drawer reporting. Until then, orders
  carry a single `paymentMethod` + `paidAt`.
- **AD-6 Stripe Terminal over a second processor** — when card-present arrives,
  it reuses the existing Stripe integration. Currently deferred: cash/card is
  recorded, not processed.
- **AD-7 PIN overlays JWT, never replaces it.** The device holds a normal session;
  a PIN switches the *acting user* for attribution and role checks (planned).
- **AD-8 Idempotency for offline.** `clientOrderId` unique per device on order
  create (planned with offline mode).
- **AD-9 Printing is an event matrix, not feature flags.** Each document type
  (kitchen ticket, customer receipt) declares which order events trigger it —
  **Save** (creation), **Update** (unpaid edit), **Paid** — plus a copy count.
  Stored per location as `printSettings.{kitchen,receipt}.{onSave,onUpdate,onPaid,copies}`.
  Defaults: kitchen on Save+Update; receipt on Paid. Every workflow (fire
  immediately, hold-until-paid delivery, receipt-on-save, silent) is a row
  configuration — no special cases. Extensible with future events (Ready,
  Cancelled). A document prints at most once when multiple events coincide
  (e.g. a POS order created already-paid = Save + Paid).

## 5. Order & Payment Lifecycle

Shared enums; the frontend renders exactly these states.

**Order status** (`orders.status`):

```
pending ──▶ confirmed ──▶ preparing ──▶ ready ──▶ delivered
   │                                                  
   └────────────▶ cancelled (any pre-delivered state)
```

- AI phone orders enter `pending`; payment or kitchen ack moves them to `confirmed`.
- POS orders enter `confirmed` (they are sent to the kitchen at creation).

**Payment state** (derived today; explicit once `payments` lands):

```
unpaid (paidAt NULL) ──▶ paid (paidAt set)
        │                     │
        │                     └──▶ refunded (planned)
        └──▶ partially_paid (planned, sum(payments) < total)
```

Editability rule: items may be replaced only while `paidAt IS NULL` and status is
`pending|confirmed`.

## 6. Module Architecture

Backend (NestJS feature modules; POS logic currently lives in `orders`):

```
src/
  orders/            # order CRUD, POS create/edit/pay, totals engine, print dispatch
    orders.controller.ts
    orders.service.ts        # priceCartItems(), getPrintPlan(), dispatchOrderSideEffects()
    dto/                     # create-pos-order, update-order-items, pay-order
  discounts/         # discount/promo CRUD (org-scoped, audited)
  menus/             # menu data incl. isFavorite
  printers/          # MQTT print pipeline, per-printer registry, print settings UI data
  payments/          # PLANNED — partial payments, split, drawer events
```

Frontend:

```
src/app/pos/page.tsx        # Register: pills, search, grid, cart, picker,
                            # tender modal (tip/discount/cash-change), open-orders drawer
src/components/
  PrintSettingsCard.tsx     # per-location print policy
  DiscountsSettings.tsx     # settings → discounts tab
Planned: LockScreen (PIN), KDS route (/kds), Floor plan, Customers drawer
```

## 7. Database Changes

**Shipped columns** (migrations 0003–0008):

- `orders`: `source`, `payment_method`, `paid_at`, `ticket_number`, `subtotal`,
  `tax_amount`, `tip_amount`, `discount_amount`, `discount_name`, `discount_id`
- `order_items`: `modifiers` (jsonb snapshot incl. optionId), `notes`
- `menu_items`: `is_favorite`
- `locations`: `tax_rate_bps`, `print_settings` (jsonb: kitchen/receipt enable,
  copies 1–5, `holdUnpaidKitchen`)
- `discounts` table: org-scoped, `name`, optional `code`, `type percent|fixed`,
  `value`, `requires_manager`, `active`, soft delete

**Planned: `payments` table** — the single definition; everything else references
this section:

```
payments
  id, organization_id, location_id, order_id,
  method        varchar   'cash' | 'card'
  amount        integer   cents applied to the order
  tip_amount    integer   cents
  cash_received integer   cents (cash only)
  change_given  integer   cents (cash only)
  created_by    uuid      acting user
  created_at    timestamp
```

Rules: order flips paid when `sum(payments.amount) >= totalAmount`;
`orders.payment_method` becomes `'split'` when methods differ; drawer reports
(Phase 3) read payments, never orders.

**Planned other:** `customers`, `floor_tables`, `drawer_sessions` + `drawer_events`,
`users.pos_pin_hash`, `orders.client_order_id` (idempotency), modifier group
`max_selections`/`selection_type`.

## 8. API Contracts

All routes under `/api/v1`, JWT-guarded, org-scoped server-side. Money is integer
cents everywhere.

### POST /orders/pos — create (paid or saved-unpaid)

```json
// request
{
  "locationId": "uuid",
  "orderType": "dine_in",
  "paymentMethod": "cash",        // omit → save unpaid (pay later)
  "tipAmount": 300,
  "discountId": "uuid",           // or "promoCode": "LUNCH10"
  "customerName": "Sarah",
  "specialInstructions": "rush",
  "items": [
    { "menuItemId": "uuid", "quantity": 2,
      "optionIds": ["uuid"], "notes": "no onions" }
  ]
}
// response 201 — full order row
{ "id": "uuid", "ticketNumber": 47, "subtotal": 2000, "taxAmount": 120,
  "tipAmount": 300, "discountAmount": 200, "totalAmount": 2220,
  "status": "confirmed", "paidAt": "…|null", "items": [ … ] }
```

### PUT /orders/:id/items — replace items on an unpaid order

Request mirrors `items`/`customerName`/`orderType`/`specialInstructions`/
`discountId` above. 400 when paid or status not `pending|confirmed`.
Re-prices everything; fires corrected kitchen ticket (unless held).

### POST /orders/:id/pay

```json
// request
{ "paymentMethod": "card", "tipAmount": 300 }
// response 200 — full order; receipt (and held kitchen ticket) print now
```

### Planned: POST /orders/:id/payments (split)

```json
{ "method": "cash", "amount": 1000, "cashReceived": 2000 }
// → { "applied": 1000, "changeGiven": 1000, "remaining": 1220, "paid": false }
```

### GET /discounts · POST /discounts · PATCH/DELETE /discounts/:id
List active (staff) or all (`?all=true`); manage requires manager+.

## 9. Roadmap (single source of truth)

| Priority | Feature | Status |
|---|---|---|
| P0 | Register UI (grid, pills, cart, picker) | **Shipped** |
| P0 | Totals engine (tax, discounts, tips, server-side) | **Shipped** |
| P0 | Cash/card recording + change calculator | **Shipped** |
| P0 | Printing incl. per-location policy + hold-until-paid | **Shipped** |
| P0 | AI order editing / Open Orders handoff | **Shipped** |
| P0 | Save-unpaid (hold) orders | **Shipped** |
| P1 | Menu search | **Shipped** |
| P1 | Favorites | **Shipped** |
| P1 | Ticket numbers | **Shipped** |
| P1 | PWA / iPad standalone | **Shipped** |
| P1 | Payments table + split payments | Planned — next |
| P1 | Manager PIN + voids/refunds | Planned — next |
| P1 | Multi-select modifiers, quantity limits | Planned |
| P2 | Customer profiles + one-tap reorder | Planned |
| P2 | KDS screen | Planned |
| P2 | Floor plan / tables / coursing | Planned |
| P2 | Stripe Terminal (card-present) | Deferred by decision |
| P3 | Drawer management + Z-reports | Planned |
| P3 | Order history search / reprint / duplicate | Planned |
| P3 | Offline mode (cash-only, idempotent sync) | Planned |
| P4 | Upsells, SKU/barcode, customer display | Future |

**Dependency graph:**

```
Totals engine ✓ → Cash POS ✓ → Printing ✓ → AI order editing ✓
                                   ↓
                    Payments table → Split payments → Drawer management
                                   ↓
                    Manager PIN → Voids/refunds
                                   ↓
              Customers → Reorder     KDS → Tables/coursing     Offline
```

## 10. Phase Deliverables & Acceptance Criteria

### Phase 1 + 1.5 — Counter-service MVP + cashier speed pack ✅ SHIPPED

Register, tender modal (tip/discount/cash-change), save-unpaid, search, favorites,
ticket numbers, AI handoff, print policy, discounts/promos, PWA.

Acceptance (verified):
- ✓ Cashier rings a 3-item order with a modifier in < 30 seconds
- ✓ Kitchen ticket prints automatically (or holds until paid per setting)
- ✓ Receipt prints at payment with tax/tip/discount lines
- ✓ AI phone order opens in the register, edits re-price server-side, corrected
  ticket marked UPDATED
- ✓ Cash tender shows change due; confirm blocked until covered
- ✓ Order appears on dashboard/orders in realtime, no manual refresh

### Phase 2 — Payments, PIN, full-service

Deliverables: payments table (§7), split (evenly/custom), manager PIN unlock,
void/refund for paid orders, multi-select modifiers, hold by table/tab name.

Acceptance:
- ✓ A $40 check splits across two cards and cash with correct remainder math
- ✓ Voiding a paid order requires manager PIN and appears in the audit log
- ✓ Refund reverses reported revenue for the day
- ✓ A required "Choose 2 toppings" group enforces min/max server-side

### Phase 2.5 — Customers

Deliverables: `customers` table, phone search, minimal create, notes, lifetime
stats, one-tap reorder.

Acceptance:
- ✓ Typing a phone number surfaces the customer in < 300ms
- ✓ "Reorder last" builds the cart in one tap with current prices

### Phase 3 — Cash discipline & operations

Deliverables: drawer sessions, blind counts, over/short, pay-in/out, Z-report,
order history search/reprint/duplicate.

Acceptance:
- ✓ Z-report totals equal `sum(payments)` for the day, by method
- ✓ Over/short computed from blind count vs expected

### Phase 4 — Hardening

Offline queue (cash-only, `clientOrderId` idempotency), email/SMS receipts,
reporting dashboard, device registry, upsells, SKU/barcode.

## 11. Non-Functional Requirements

```
Register cold open           < 2s
Menu search keystroke        < 100ms
Add item to cart             < 50ms (no network on tap)
Tender modal open            < 100ms
Kitchen ticket at printer    < 2s after action
Realtime order propagation   < 1s
WebSocket reconnect          < 3s
Touch targets                ≥ 44px; no hover-dependent UI on /pos
```

## 12. Device Support

- iPad (Safari standalone PWA — primary demo target), Android tablets, touchscreen
  Windows terminals (Chrome)
- 80mm ESC/POS thermal printers over MQTT (kitchen + receipt), 1–5 copies each
- Future: Stripe WisePOS E / S700, barcode scanners, cash drawers (fire via
  receipt printer pulse), customer-facing display

## 13. Risks

- **Tax complexity** (inclusive rates, per-item overrides, channel rules): flat
  per-location bps is a simplification; `tax_rates` table is the escape hatch.
- **Ticket-number races**: per-location daily max+1 inside the insert transaction;
  acceptable at single-register volume, revisit with multiple concurrent devices.
- **ESC/POS vendor variance**: restart is `ESC @` (buffer reset) — true reboot
  needs vendor-specific commands per model.
- **Offline scope creep**: cash-only offline is tractable; anything more is its
  own project. Keep it Phase 4.
- **Stale-cookie auth loops** on shared iPads: mitigated (middleware no longer
  trusts cookie presence; failed refresh clears the cookie server-side).

## 14. Future Enhancements

Gift cards, loyalty/points, scheduled orders, multi-language tickets, per-category
printer routing (fryer vs grill stations), delivery-platform integrations,
customer-facing tipping screen.
