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

## Risks / open questions

- **Tax complexity** (inclusive vs exclusive, per-item overrides, delivery-channel rules) — start with a single default rate per location, model `tax_rates` so per-item mapping can be added without migration pain.
- **Stripe Terminal hardware availability** in the target market — verify reader models (WisePOS E / S700) and Tap-to-Pay support before committing UX.
- **Tablet targets:** the AntD dashboard is desktop-first; the `/pos` route group needs its own touch-first layout primitives (min 48px targets, no hover-dependent UI).
- **Offline scope creep:** cash-only offline is tractable; anything more (offline card, multi-device cart sync) is a project of its own — keep it Phase 4 and cash-only.
