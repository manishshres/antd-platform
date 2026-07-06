# POS Implementation Plan — Toast/Square-style Point of Sale

Goal: an in-store, touch-first POS for restaurants, built on the existing platform
(NestJS backend + Next.js/AntD frontend), reusing the menu, orders, printing,
real-time, and multi-tenant auth systems that already exist.

---

## What we already have (reuse, don't rebuild)

| Capability | Where | POS reuse |
|---|---|---|
| Menu: categories, items, modifiers, availability, per-location | `menus` module | Item grid + modifier picker read the same tables |
| Orders + order items, status flow | `orders` module | POS creates the same orders; KDS/expo consume them |
| Kitchen/receipt printing over MQTT (QoS 2, retries) | `printers` module | Receipt + kitchen tickets fire on POS checkout |
| Real-time to browsers (WebSocket rooms per org + SSE) | `events` gateway | Live order board / KDS updates |
| Stripe SDK + webhook handler | `stripe`, `billing` | Extend to Stripe Terminal + PaymentIntents |
| JWT auth, role hierarchy, org/location scoping, audit log | `auth`, `common` | PIN-based fast user switching layers on top |
| AI phone orders → orders table | webhooks pipeline | POS shows AI orders in the same queue |

## Gap analysis vs Toast/Square

1. **Order-taking UI** — touch-first: category rail → item grid → modifier flow → cart.
2. **Payments** — card-present (Stripe Terminal), cash w/ change calc, tips, split/partial payments, refunds, offline card queue.
3. **Order item fidelity** — `order_items` currently stores only `menuItemId, quantity, price`: no modifier selections, no per-item notes, no seat/course. Snapshot needed.
4. **Checks/tabs & dine-in** — tables, open tabs, merge/split checks, coursing.
5. **Cash & shift management** — drawer sessions, pay-in/out, close-out counts, Z-report.
6. **Taxes, service charges, discounts/comps/voids** — with role-gated approval + audit.
7. **KDS (kitchen display)** — screen alternative to printed tickets.
8. **Offline resilience** — POS must keep taking orders when the internet blips.
9. **Reporting** — sales summary, product mix, payment reconciliation, labor-adjacent hooks.

---

## Phasing

### Phase 1 — Counter-service MVP (quick-service flow, like Square for Restaurants "quick service")

The smallest thing a restaurant can ring up real sales on.

**Schema (all in `schema.ts`, additive):**

```
payments            id, orgId, locationId, orderId, method('card'|'cash'|'other'),
                    provider('stripe_terminal'|'manual'), providerPaymentId,
                    amount, tipAmount, status('pending'|'succeeded'|'refunded'|'failed'|'voided'),
                    cashReceived, changeGiven, createdBy, createdAt

order_item_modifiers_snapshot   id, orderItemId, modifierName, optionName, priceAdjustment
       (or a jsonb `modifiers` column on order_items — simpler, recommended)

order_items         + notes varchar, + status('active'|'voided'), + voidReason, + voidedBy

orders              + subtotal, taxAmount, discountAmount, serviceChargeAmount, tipAmount
                    + source('pos'|'ai_phone'|'online'), + paidAt, + createdBy (staff)
                    + orderNumber (per-location daily sequence for tickets: "#47")

tax_rates           id, orgId, locationId?, name, ratePercent(basis points), isDefault
discounts           id, orgId, name, type('percent'|'fixed'), value, requiresManager, active
```

**Backend:**
- `pos` module: `POST /pos/orders` (cart → order w/ item snapshots, totals computed **server-side**),
  `POST /pos/orders/:id/payments` (cash: record + change; card: create Stripe Terminal PaymentIntent),
  `POST /pos/payments/:id/capture`, `POST /pos/payments/:id/refund` (role-gated).
- Totals engine in the service layer: subtotal → discounts → tax → service charge → tip. Never trust client math.
- Stripe Terminal: connection-token endpoint, register readers per location, webhook extension for `payment_intent.succeeded` (terminal).
- On paid: enqueue kitchen ticket + receipt on the existing `print-queue`; emit `order.created` to org room.

**Frontend (`/pos` route group — full-screen, no dashboard chrome):**
- Register screen: left category rail (reuses menu data), center item grid (big touch targets), right cart panel.
- Modifier modal honoring `isRequired`; qty steppers; per-item notes.
- Charge flow: tender screen (cash keypad w/ change calc, card via Terminal SDK, tip prompt).
- Order queue screen: live board of open orders (WebSocket), status advance buttons (reuses `PATCH /orders/:id/status`).
- PIN lock screen for fast staff switching (PIN maps to a real user; JWT stays the session backbone).

**Exit criteria:** ring up an order, take cash or card, ticket prints in kitchen, receipt prints, order appears on dashboard + reports match Stripe.

### Phase 2 — Full-service restaurant (the Toast differentiators)

```
floor_tables        id, locationId, name, seats, area, x/y (floor map), active
checks              id, orderId?, tableId?, name("Tab: Sarah"), status('open'|'closed'),
                    openedBy, openedAt, closedAt
        (alternatively: orders.status gains 'open' and orders get tableId — fewer joins,
         recommended unless split-check complexity demands separate checks)
order_items         + seatNumber, + courseNumber
```

- Open tabs & saved carts; send-to-kitchen by course ("fire course 2").
- Split check: by seat, by item, or even N-way — payments table already supports multiple partial payments per order.
- Floor plan screen (drag-drop table layout, color by status).
- KDS route (`/kds`): fullscreen ticket rail fed by WebSocket, bump/recall, item-level done states — replaces or complements printed tickets.

### Phase 3 — Cash discipline & operations

```
drawer_sessions     id, locationId, deviceId, openedBy, openingFloat, closedBy,
                    countedCash, expectedCash, overShort, openedAt, closedAt
drawer_events       id, sessionId, type('sale'|'refund'|'payin'|'payout'|'drop'), amount, reason, userId
```

- Open/close shift flows, blind counts, over/short reporting, manager-gated payouts.
- Z-report (end-of-day): sales by category, payment type totals, tax collected, discounts/voids log.
- Void/comp flows requiring manager PIN; all writes hit the existing `auditService`.

### Phase 4 — Hardening & scale

- **Offline mode:** PWA + IndexedDB queue. Cart building and cash sales work offline; queued orders sync with idempotency keys (`clientOrderId` unique per device) when back online. Card-present requires connectivity (same constraint as Square).
- Receipt options: email/SMS receipts (email queue exists; SMS via Telnyx).
- Reporting dashboard: product mix, hourly sales heatmap, AI-phone vs POS source split.
- Device management: register devices per location, revocable device tokens.
- Customer-facing display / online-ordering reuse of the same totals engine.

---

## Key architecture decisions

1. **One orders table for all channels.** POS, AI phone, and future online ordering all write `orders` with a `source` column — dashboards, printing, and analytics stay unified (the AI webhook pipeline already proves this shape works).
2. **Server-side totals engine.** The POS client sends item ids + modifier option ids + quantities; the backend prices everything from the DB and returns the computed check. Prevents price tampering and keeps tax logic in one place.
3. **Price snapshots at order time.** `order_items.price` already snapshots; extend the same principle to modifier selections (jsonb snapshot) so menu edits never mutate historical orders.
4. **Stripe Terminal over a second processor.** Stripe is already integrated (SDK, webhooks, per-org customers); Terminal adds card-present with the same reconciliation surface.
5. **PIN unlock ≠ new auth system.** The device holds a normal refresh-token session; PIN switches the *acting user* for attribution and role checks, logged via audit service.
6. **Idempotency everywhere.** `clientOrderId` on order create, Stripe idempotency keys on payment create — required for offline sync and double-tap protection.

## Suggested build order (Phase 1 detail)

1. Schema migration: payments, tax_rates, discounts, order/order_items columns.
2. Totals engine service + unit tests (pure function: cart → totals; most valuable tests in the project).
3. `pos` module endpoints (order create w/ snapshots, cash payment, status).
4. `/pos` register UI (menu grid + cart + cash tender) — usable end-to-end with cash only.
5. Print + real-time wiring (mostly configuration; queues exist).
6. Stripe Terminal (connection tokens, reader registration, card tender UI, webhook).
7. PIN lock + role-gated void/discount.
8. Order queue screen + dashboard source split.

Each step lands independently; cash-only POS is sellable after step 5.

## Gap analysis vs Toast/Square/Clover cashier checklist (2026-07-05)

Audit of the "fast cashier MVP" checklist against what is built and what the plan covered.
Guiding metric: **an order in under 30 seconds.**

### Built ✅

| Feature | Where |
|---|---|
| Category tabs (scrollable pills) | `/pos` |
| Add/remove items, big +/- quantity | `/pos` cart |
| Item notes + order notes | `/pos` picker + cart |
| Required/optional modifiers, price adjustments | picker + server validation |
| Automatic server-side price calculation | `POST /orders/pos` |
| Tax calculation (per-location rate) | orders service, settings page |
| Cash / card recording | `paymentMethod` on orders |
| Auto print (kitchen + receipt), reprint endpoint | print pipeline |
| Modifier/tax/printer settings for owners | menu mgmt + settings |

### Was missing from BOTH the build and the original plan — now added below

| Feature | Disposition |
|---|---|
| **Edit an open order in the POS (incl. AI voice orders)** | NEW Phase 1.5 — flagship flow, see below |
| Menu search-as-you-type | Phase 1.5 (client-side filter; menu is already fully loaded) |
| Favorites / pinned items (⭐ virtual category first) | Phase 1.5 (`menu_items.isFavorite`) |
| Cart line quick actions (edit, duplicate, void line) | Phase 1.5 |
| Customer records: phone search, minimal create, notes, lifetime stats | Phase 2.5 (`customers` table) |
| One-tap reorder ("duplicate last order") | Phase 2.5 (needs customers) |
| Coupons / promo codes | Phase 2.5 (extends planned `discounts` table with `code`) |
| Multi-select modifier groups, quantity limits, free-topping counts | Phase 2 (schema: `menuModifiers.maxSelections`, `selectionType`) |
| Suggested upsells | Phase 4 (optional) |
| SKU / barcode on menu items | Phase 4 (add `sku` column when hardware lands) |

### Was already in the plan, still to build (unchanged phasing)

- Per-location daily ticket numbers ("#1024") — Phase 1 schema, not yet built
- Tips, discounts UI, refunds, manager PIN — Phase 1 tail
- Hold/resume orders (tabs by name/phone/table), split payments — Phase 2
- Receipt email/SMS/no-receipt choice — Phase 4 (print-only until then)
- Order history search (order #, customer, phone, date) + refund/duplicate actions — Phase 3 reporting

### Phase 1.5 — Cashier speed pack (insert before Phase 2)

The under-30-seconds features, all buildable on current schema:

1. **Open & edit existing orders in the POS — the AI voice handoff.**
   - `/pos?orderId=<id>` loads an existing order into the cart (items, modifiers, notes).
   - Orders page and the live `order.created` toast get an "Open in POS" action, so a
     phone order placed by the AI lands in front of the cashier ready to adjust.
   - Backend: `PUT /orders/:id/items` — replace items/notes on an order that is not yet
     paid/completed (`paidAt IS NULL`), re-price server-side, reprint a corrected kitchen
     ticket (marked "UPDATED"), audit the change. AI orders are unpaid (`source='ai_phone'`),
     so they remain editable until the cashier takes payment; POS cash/card orders are paid
     at creation and require the (future) manager-PIN void/refund path instead.
   - Paying an edited AI order: `POST /orders/:id/pay { paymentMethod }` sets
     paymentMethod/paidAt and advances status — same simplified cash/card recording.
2. **Search box** above the category pills — instant client-side filter across all
   categories by item name (SKU later), shows a flat result grid.
3. **Favorites**: `is_favorite` boolean on menu items, star toggle in Menu Management, and
   a ⭐ Favorites pseudo-category pinned first in the POS (defaults to the whole menu's
   20–30 best sellers being hand-picked by the owner).
4. **Cart line actions**: tap a line to reopen the modifier picker pre-filled (edit),
   plus duplicate-line and void-line buttons.
5. **Ticket numbers**: per-location daily sequence stored on orders, shown as "Order #47"
   in the POS header, cart, tickets, and order board.

## Tender flow v2 (2026-07-05) — shipped & next

Shipped: Save-without-paying (unpaid order, kitchen fires, receipt deferred to payment),
single Charge button → tender modal (tip, discount), cash-tendered / change-due calculator,
Open Orders drawer for settling AI phone orders at the counter.

### Split payments — design (next round)

Needs the `payments` table from Phase 1 (one order → many payments) rather than the
single `paymentMethod` column:

```
payments   id, orgId, locationId, orderId, method('cash'|'card'), amount, tipAmount,
           cashReceived, changeGiven, createdBy, createdAt
```

- `POST /orders/:id/payments { method, amount, cashReceived? }` — records a partial
  payment; order flips to paid when `sum(payments.amount) >= totalAmount`.
  `orders.paymentMethod` becomes 'split' when methods differ.
- Tender modal gains a third button: **Split** → choose "Split evenly (N ways)" or
  "Custom amount"; shows remaining balance after each partial payment and loops the
  cash/card step until the balance hits zero.
- Cash-drawer reporting (Phase 3) reads `payments`, not orders, so cashReceived /
  changeGiven persist per payment.

## Risks / open questions

- **Tax complexity** (inclusive vs exclusive, per-item overrides, delivery-channel rules) — start with a single default rate per location, model `tax_rates` so per-item mapping can be added without migration pain.
- **Stripe Terminal hardware availability** in the target market — verify reader models (WisePOS E / S700) and Tap-to-Pay support before committing UX.
- **Tablet targets:** the AntD dashboard is desktop-first; the `/pos` route group needs its own touch-first layout primitives (min 48px targets, no hover-dependent UI).
- **Offline scope creep:** cash-only offline is tractable; anything more (offline card, multi-device cart sync) is a project of its own — keep it Phase 4 and cash-only.
