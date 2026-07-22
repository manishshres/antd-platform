# Coneeko Platform — Manual Test Plan

> Living document. Manual QA coverage for the whole platform: NestJS backend
> (`apps/backend`), Next.js dashboard (`apps/frontend`), and the Expo tablet POS
> (`apps/pos`), plus the AI phone line and the marketplace order aggregator.
>
> Execute top to bottom for a full regression, or jump to a suite for targeted
> testing. Cases are ordered so that later suites can assume earlier setup.

---

## 1. How to use this plan

### 1.1 Case format

Each case has an **ID**, a **priority**, **preconditions**, **steps**, and an
**expected result**. Record the outcome as Pass / Fail / Blocked with the build
under test and the date.

- **ID** — `AREA-NN` (e.g. `POS-12`). Stable; don't renumber when inserting —
  append.
- **Priority** — **P1** blocks release (money, data loss, security, core order
  flow), **P2** important, **P3** cosmetic/edge.

### 1.2 Environments

| Env | Backend | Dashboard | POS points at |
| --- | --- | --- | --- |
| Local | `localhost:4000` | `localhost:3000` | tablet → laptop LAN IP `:4000` |
| Staging | staging API | staging dashboard | staging `/api/v2` |
| Prod | ⚠️ smoke only, no destructive cases | — | — |

The POS talks **only** to the public API (`/api/v2`, `x-api-key`). The dashboard
talks to the JWT API (`/api/v1`). Keep that boundary in mind when a case fails —
it narrows where the bug is.

### 1.3 Test accounts & roles

Provision one account per role to exercise gating. Role hierarchy:
`owner > admin > manager > agent > viewer` (backend `MANAGER_ROLES = manager,
admin, sysadmin, platform_admin`).

| Role | Can | Use for |
| --- | --- | --- |
| platform_admin | everything, cross-org | admin/audit suites |
| admin / sysadmin | full org menu + settings | menu, settings |
| manager | menu edits, voids, reports | POS manager actions |
| agent (cashier) | take orders, no admin | POS cashier flow |
| viewer | read-only | negative permission cases |

POS employees sign in by **email + PIN**; provision at least one manager PIN and
one non-manager PIN.

### 1.4 Devices

- POS **must** run on the target **11" Android tablet in landscape** — layout and
  touch targets are tuned for it. A phone or emulator is smoke-only.
- Bluetooth kitchen printing needs a **real ESC/POS printer**; it cannot be
  verified in an emulator.

### 1.5 Money & data conventions

- All money is **integer cents** end to end. A price shown as `$6.99` is `699`.
- Totals must match between POS and backend: tax is `round(base × bps / 10000)`.
- Soft deletes: "deleted" rows keep a `deletedAt`; verify they disappear from
  normal lists but remain in "show deleted" / history where applicable.

---

## 2. Setup & smoke (SETUP)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| SETUP-01 | P1 | Backend running | `GET /api/v1/health` | 200; body reports version matching `package.json` |
| SETUP-02 | P1 | Docker up | Confirm Postgres, Redis, Mosquitto containers healthy | All three up; backend logs no connection errors |
| SETUP-03 | P1 | Fresh dev DB | Boot backend once | Default plans seeded; dev admin `test@example.com` seeded **only** when `NODE_ENV != production` |
| SETUP-04 | P2 | — | Open dashboard `/` unauthenticated | Redirects to `/login` |
| SETUP-05 | P2 | — | Hit `/api/docs` in non-prod | Swagger loads; in prod it is **not** mounted |

---

## 3. Auth & organization (AUTH)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| AUTH-01 | P1 | Registered user | Login with correct email/password | 200; access token + user returned; lands on `/dashboard` |
| AUTH-02 | P1 | — | Login with wrong password | Rejected; no token; generic error (no stack trace) |
| AUTH-03 | P1 | Logged in | Leave the tab idle past access-token expiry (~15 min), then act | Silent proactive refresh; no forced re-login |
| AUTH-04 | P2 | Logged in | Logout | Refresh token revoked; protected routes bounce to `/login` |
| AUTH-05 | P1 | Public registration | Attempt to register with role `admin`/`owner` | Role is **not** granted; created as a normal user |
| AUTH-06 | P2 | rememberMe login | Refresh repeatedly over time | 30-day TTL preserved across rotations, not collapsed to 24h |
| AUTH-07 | P1 | viewer role | Call a manager-only endpoint | 403 Forbidden |

---

## 4. Locations & settings (LOC)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| LOC-01 | P1 | admin | Create a location (name, address, tax rate) | Saved; appears in location switcher |
| LOC-02 | P2 | 2+ locations | Switch active location in dashboard header | Menu/orders/tables rescope to the selected location |
| LOC-03 | P2 | Location with tax 8.25% | Confirm `taxRateBps = 825` | Stored as basis points, not a float |
| LOC-04 | P2 | Location | Set an auto-gratuity/service charge rate | Stored in bps; surfaces as an opt-in toggle at POS checkout |
| LOC-05 | P3 | Location | Edit address/phone | Persists; reflected in POS after sync (see POS-05) |

---

## 5. Menu management (MENU)

Covers categories, items, modifier groups, and **category-level modifiers**
(recently added).

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| MENU-01 | P1 | admin, location selected | Create a category | Appears in sidebar; org-level (no location) categories also show |
| MENU-02 | P1 | Category exists | Add an item (name, price in dollars) | Saved; price stored as cents (`$6.99` → `699`) |
| MENU-03 | P1 | Item exists | Edit item name/price/description and Save | **Persists** (no 400) — regression guard for the `locationId`-on-update bug |
| MENU-04 | P2 | Item exists | Toggle availability off | Item hidden from POS ordering after sync; still visible in admin |
| MENU-05 | P1 | Modifier group "Spice Level" exists | Open **Edit Category**, assign a modifier group, Save | Saved; every item in that category inherits the modifier (shows the tag) |
| MENU-06 | P1 | Category has an assigned modifier | Re-open Edit Category | The modifier is **pre-selected** in the form (seeded from existing) |
| MENU-07 | P1 | Category modifier assigned | Remove it in Edit Category, Save | Removed from all items in the category |
| MENU-08 | P1 | Item with a modifier | Open item, uncheck the modifier, Save | Removal **persists** (regression guard: `DELETE /items/:id/modifiers/:modifierId`) |
| MENU-09 | P2 | Sidebar "⋯" and toolbar "Edit category" | Open category edit from **both** entry points | Both seed the modifier field identically |
| MENU-10 | P2 | `admin` role (not sysadmin) | Load menu page | Add/Edit/Delete controls render (role check includes admin/manager) |
| MENU-11 | P3 | Modifier group | Delete a modifier group | Removed; items no longer offer it |
| MENU-12 | P2 | Deleted item, platform_admin | Toggle "show deleted" | Soft-deleted rows appear struck-through; restorable |

---

## 6. POS — connection, sign-on, business day (POS-SETUP)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| PS-01 | P1 | Fresh POS install | Launch app | Connection-setup screen gates everything until API URL + key set |
| PS-02 | P1 | QR from dashboard | Scan the connection QR | API URL + key auto-filled; connects |
| PS-03 | P1 | Connected, no employee | — | Sign-on screen shown; cannot proceed without PIN |
| PS-04 | P1 | Valid email + PIN | Sign in | Signed in; **clock-in** punched automatically |
| PS-05 | P1 | Signed in, first sync completes | Observe catalog | Categories **and** menu items appear **without** opening Settings (location auto-selected) — regression guard |
| PS-06 | P1 | No business day open | — | Start-Day screen shown; entering a drawer amount opens the day |
| PS-07 | P2 | Business day open, end it same calendar day, reopen | Start Day again same day | Reopens the same day, no confusing duplicate |
| PS-08 | P2 | Manager hands tablet to cashier via Switch Employee while on Reports/Settings | Switch to a non-manager | Bounced off admin screens to Home |
| PS-09 | P3 | Signed in | Confirm clocked-in time badge in sidebar | Shows shift start time |

---

## 7. POS — ordering & cart (CART)

The core money path. Test on the tablet.

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| CART-01 | P1 | Catalog loaded | Single-tap a product with no required modifiers | Adds one immediately (no dialog, no delay) |
| CART-02 | P1 | Same product | Tap it 3× rapidly | Quantity becomes 3 — **not** zero, and no dialog opens (repeat-tap regression) |
| CART-03 | P1 | Product with optional modifiers | Long-press the card | Customize dialog opens |
| CART-04 | P1 | Product with a **required** modifier group | Tap the card | Dialog opens on tap (can't quick-add an incomplete item) |
| CART-05 | P1 | — | Add "Chicken Curry (Spicy)", then add "Chicken Curry (Regular)" | **Two separate cart lines**, one Spicy one Regular — not a merged qty-2 line (line-identity regression) |
| CART-06 | P1 | Two identical adds | Add the same item with identical options twice | Merges into one line, qty 2 |
| CART-07 | P1 | Cart has the two curry lines | Edit the Spicy line's quantity to 5 | Only the Spicy line changes; Regular untouched |
| CART-08 | P2 | Modifier dialog | Set "Extra Cheese ×2" via the stepper | Priced twice (2 × adjustment); ticket shows the quantity |
| CART-09 | P1 | Item with a manager price override | Apply an override (manager PIN) | Line price replaced; reason captured; override flagged on the line |
| CART-10 | P2 | Cart with items | Apply a discount / coupon | Discount reduces the taxable base; tax recomputed after discount |
| CART-11 | P1 | Cart with items | Read Subtotal / Tax / Total | Totals match backend math on sync (round(base × bps/10000)) |
| CART-12 | P2 | Order type selector | Switch Dine-in / Pickup / Delivery | Header reflects type; type rides on the order |
| CART-13 | P1 | Cart with items | Kill the app (swipe away), relaunch | Draft cart is **restored** (lines, customer, table) — crash-recovery regression |
| CART-14 | P2 | Draft restored | Clear the cart | Draft removed from storage; relaunch shows empty cart |
| CART-15 | P2 | Barcode/SKU item | Scan a barcode | Matching item added; unknown code shows "no product found" |

---

## 8. POS — Save / Send / Pay lifecycle (FLOW)

Three distinct actions with distinct effects. Verify each does **only** its job.

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| FLOW-01 | P1 | Cart with items | Tap **Save Order** | Order parked as `held`; **does not print**; **does not** reach KDS; stays local |
| FLOW-02 | P1 | Held order in Orders → Held | Resume it | Loads back into the cart, editable, exactly as left |
| FLOW-03 | P1 | Cart with items | Tap **Send** | Fires to kitchen; order becomes an active/open tab; appears on KDS; prints (if a printer is set) |
| FLOW-04 | P1 | Sent order | Add more items, tap Send/Save-to-Tab again | Only the **new** items print — not the whole ticket again (incremental send) |
| FLOW-05 | P1 | Sent tab, showing 3 of an item | Try to reduce that fired line to 1 (via stepper **and** via the edit dialog) | Cannot drop below fired qty; clamped both ways (no silent kitchen/bill divergence) |
| FLOW-06 | P1 | Cart with items | Tap **Pay** | Goes to payment; button reads `Pay $<total>` |
| FLOW-07 | P1 | Send button | Tap Send 3× rapidly | Exactly **one** tab / one set of tickets created — not three (duplicate-send latch) |
| FLOW-08 | P2 | Save-to-Tab | Tap it 3× rapidly | Delta appended **once**, not thrice |
| FLOW-09 | P1 | Order with appetizers ready, mains cooking | Take payment while kitchen still open | Payment succeeds; kitchen status independent of paid status |
| FLOW-10 | P2 | Table order, courses enabled | Fire course by course | Each course prints as its own ticket when fired |

---

## 9. POS — payment & tender (PAY)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| PAY-01 | P1 | On payment screen | Pay full amount in cash, over-tender | Change due computed correctly; order marked paid |
| PAY-02 | P1 | — | Pay by card | Marked paid; payment method recorded |
| PAY-03 | P2 | — | Gift Card / Store Credit / Other tenders | Each records against the order |
| PAY-04 | P1 | Multi-item order | Split payment across 2+ tenders | Sum of tenders = total; order fully settled only when covered |
| PAY-05 | P1 | Table with several items | Split check into N checks, pay each | Each check settles independently; totals reconcile to the whole |
| PAY-06 | P2 | Tip enabled | Add a tip at payment | Tip added on top; recorded separately |
| PAY-07 | P2 | Service charge on location | Toggle auto-gratuity at checkout | Charge computed off taxable base, itself taxable |
| PAY-08 | P1 | Paid order | Confirm receipt prints (if auto-receipt on) | Receipt shows all lines with correct names/prices |

---

## 10. POS — Orders screen & history (ORD)

The consolidated Orders screen (Active / Held / Unsynced / History filters).

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| ORD-01 | P1 | Mix of orders exist | Open Orders | Four filters: **Active / Held / Unsynced / History** (no "Open Tabs" wording) |
| ORD-02 | P1 | Active tab | Inspect an order card | Shows ticket, customer, type, table, elapsed time, status pill, paid state, total |
| ORD-03 | P1 | Held filter | — | Lists `held` orders; each resumable |
| ORD-04 | P1 | Unsynced filter, an order failed to sync | — | Lists pending/failed; per-order **Retry** works |
| ORD-05 | P1 | History filter, online | Search + date range | Server-backed results; falls back to local when offline |
| ORD-06 | P1 | Any order | Open its detail | **Item names and prices render** (regression: server order-detail shape) |
| ORD-07 | P2 | Server order from another register | Open detail while online | Loads; items correct |
| ORD-08 | P1 | Paid/closed order, manager | Void & Refund | **Manager PIN required**; void succeeds; drops out of paid totals |
| ORD-09 | P3 | Offline | Open a server-only order's detail | Graceful "go online" message, not a crash |

---

## 11. POS — tables & tabs (TAB)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| TAB-01 | P1 | Floor plan synced | Open Tables | Tables render by floor plan with status colors |
| TAB-02 | P1 | Vacant table | Tap it, set guests | Table attached to cart; go to Home to add items |
| TAB-03 | P1 | Occupied table | Tap it | Dialog: Cancel / View Tab / Add to Tab / **Close Tab & Pay** |
| TAB-04 | P1 | Occupied table, local tab | Tap **Close Tab & Pay** | Loads the tab into the cart and jumps to the payment screen |
| TAB-05 | P2 | Tab opened on another register | Tap the table → Close Tab & Pay | Falls back to View Tab (can't settle lines this device doesn't hold) |
| TAB-06 | P2 | Counter-only location (no floor plan) | Open nav | **Tables** is hidden entirely |
| TAB-07 | P2 | Open tab | Resume from Orders → Active | Reopens as a tab (baseline preserved, appends only) |

---

## 12. POS — kitchen print queue (PRINT)

Requires a real Bluetooth ESC/POS printer for full coverage; the queue/UI cases
can be checked without one.

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| PRINT-01 | P1 | Printer paired, auto-kitchen on | Send an order | Ticket prints; no failure badge |
| PRINT-02 | P1 | Printer **off / disconnected** | Send an order | Order **still created**; a red "N prints failed · Retry" badge appears in the top bar |
| PRINT-03 | P1 | Failed print, printer back on | Tap the failure badge (or foreground the app) | Queued job retries and prints; badge clears |
| PRINT-04 | P1 | Job mid-print, kill the app | Relaunch | Stranded job is recovered and retried (not silently lost) |
| PRINT-05 | P2 | Stations configured (Grill/Bar) | Send an order spanning stations | One ticket per station to its own printer; a failure on one doesn't block the other |
| PRINT-06 | P2 | No printer paired for a station | Send items routed there | Job marked failed with "No printer paired for <station>"; visible, not silent |
| PRINT-07 | P3 | Order detail (history) | Reprint kitchen tickets | Re-enqueues per station |

---

## 13. POS — offline & sync (SYNC)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| SYNC-01 | P1 | Online | Take and pay an order, then go offline mid-day | Order already synced; no loss |
| SYNC-02 | P1 | Offline | Take several orders | Queued locally with `pending_sync`; UI never blocks on network |
| SYNC-03 | P1 | Offline orders queued | Come back online | Auto-sync pushes them; idempotent (local UUID = `clientOrderId`) — no duplicates on the server |
| SYNC-04 | P1 | Same order synced twice (retry) | Force a re-push | Server dedupes via `clientOrderId`; single order |
| SYNC-05 | P2 | Dirty customer created offline | Reconnect | Customer syncs up |
| SYNC-06 | P2 | Catalog changed on server | Sync Now | POS reflects new items/prices/tables |

---

## 14. POS — KDS bump screen (KDS)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| KDS-01 | P1 | Orders sent to kitchen (any source) | Open KDS | Every cooking order shows, oldest first — regardless of dine-in/pickup/delivery/**marketplace**/phone |
| KDS-02 | P1 | Ticket on KDS | Read the card | Shows ticket #, type, table (if any), customer, items, modifiers, special instructions, elapsed timer |
| KDS-03 | P1 | Ticket cooking a while | Watch the timer | Age band escalates (fresh → warm → late) |
| KDS-04 | P1 | Ticket | Tap Bump | Marked ready server-side; drops off KDS on next poll |
| KDS-05 | P2 | Held order (not sent) | — | **Does not** appear on KDS |

---

## 15. AI phone ordering (AIP)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| AIP-01 | P2 | Location provisioned with a Telnyx number | Place a test call | Assistant answers; menu is known (synced to knowledge base) |
| AIP-02 | P2 | Menu changed | Re-publish menu to AI | `menuLastSyncedAt` updates; assistant reflects changes |
| AIP-03 | P1 | AI takes an order | Complete a phone order | Order lands in the system as source `ai_phone`; appears on KDS and in Orders |
| AIP-04 | P3 | Call completes | Check call history + recording | Log present; recording proxied via neutral URL (no Telnyx branding leaked) |

---

## 16. Order aggregator — marketplaces (AGG)

DoorDash / UberEats / Grubhub / KitchenHub ingestion.

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| AGG-01 | P2 | Integration account configured | Send a test marketplace webhook | Webhook accepted quickly (verify + enqueue), processed off-thread |
| AGG-02 | P1 | Webhook processed | Check Orders | Normalized order created with the correct **source** (doordash/ubereats/grubhub) |
| AGG-03 | P1 | Marketplace order | Open KDS | Appears like any other kitchen order, source badge visible |
| AGG-04 | P2 | Provider status update webhook | Send a status transition | Order status follows the allowed transition; invalid transitions rejected |
| AGG-05 | P2 | Stored credentials | Inspect at rest | Provider credentials **encrypted**, not plaintext |
| AGG-06 | P3 | Duplicate provider webhook | Re-send same external order | Deduped; single native order |

---

## 17. Per-location feature enablement (FEAT) — planned

> The feature isn't built yet. These cases define the acceptance criteria for
> AI Phone / POS / Order Aggregator toggles per location, enforced in **both**
> the dashboard UI and the API. Mark all **Blocked** until implementation lands,
> then run.

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| FEAT-01 | P1 | admin, a location | Open location settings | Per-feature toggles visible: **AI Phone**, **POS**, **Order Aggregator** |
| FEAT-02 | P1 | Location with **POS disabled** | UI | POS-related controls hidden/greyed for that location |
| FEAT-03 | P1 | Location with **POS disabled** | POS app tries to sync with that location's key | API **refuses** (not just hidden) — real enforcement |
| FEAT-04 | P1 | Location with **Aggregator disabled** | Send a marketplace webhook for it | API rejects/ignores (e.g. 403); no order created |
| FEAT-05 | P1 | Location with **AI Phone disabled** | — | Number not provisioned / calls not accepted; dashboard hides AI controls |
| FEAT-06 | P2 | Toggle a feature **off then on** | Re-check | State persists; enforcement flips accordingly |
| FEAT-07 | P2 | Two locations, one feature on/off each | — | Enforcement is **per location**, not org-wide |
| FEAT-08 | P2 | Default for a **new** location | Create one | Defaults are intentional and documented (decide: on or off by default) |
| FEAT-09 | P1 | non-manager | Attempt to toggle features | Rejected (settings change is manager+ gated) |
| FEAT-10 | P3 | Feature disabled | Confirm existing data | Disabling hides/blocks new activity but doesn't destroy historical orders |

---

## 18. Billing & plans (BILL)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| BILL-01 | P2 | Plan with a website-import limit | Exceed it | 402 / limit-reached, not a crash |
| BILL-02 | P2 | Org on a plan | View usage meters | Reflect actual usage |
| BILL-03 | P3 | Stripe checkout | Start a plan change | Redirects to Stripe portal |

---

## 19. Reports & audit (RPT)

| ID | Pri | Preconditions | Steps | Expected |
| --- | --- | --- | --- | --- |
| RPT-01 | P1 | A business day with sales across shifts | Open POS Reports | "Today's Sale" / totals scoped to the **business day**, not a single drawer session |
| RPT-02 | P2 | Drawer opened/closed | Cash Drawer reconciliation | Expected vs counted computed from session sales |
| RPT-03 | P2 | Manager action (void, override) | Check audit log | Action captured with user + timestamp + reason where applicable |
| RPT-04 | P3 | Dashboard analytics | Open charts | Render without error for the selected range |

---

## 20. Cross-cutting non-functional (NFR)

| ID | Pri | Area | Check |
| --- | --- | --- | --- |
| NFR-01 | P1 | Security | No stack traces leak to clients; errors normalized |
| NFR-02 | P1 | Security | POS API key scoped to its location's org; can't read another org's data |
| NFR-03 | P2 | Perf | POS Home item grid scrolls smoothly with a large catalog on the target tablet |
| NFR-04 | P2 | Perf | Switching tables / opening Orders is immediate (no visible network wait) |
| NFR-05 | P2 | a11y | Dashboard interactive elements have labels; contrast meets AA |
| NFR-06 | P3 | i18n/format | Money formats correctly; no floating-point cents artifacts |

---

## 21. Regression checklist (fast pass)

Run this subset before every release — the highest-risk, recently-changed paths:

- [ ] CART-02 — repeat-tap adds N, never 0
- [ ] CART-05 — spicy + regular are two lines
- [ ] CART-13 — draft survives app kill
- [ ] FLOW-01 — Save Order doesn't print or hit KDS
- [ ] FLOW-04 — incremental send prints only new items
- [ ] FLOW-05 — can't reduce a fired line below fired qty
- [ ] FLOW-07 — triple-tap Send makes one order
- [ ] ORD-06 — order detail shows item names/prices
- [ ] PS-05 — items appear after first sync without opening Settings
- [ ] PRINT-02 — printer off: order still created, badge shown
- [ ] PRINT-04 — print survives app restart
- [ ] MENU-03 / MENU-08 — item edit + item-modifier removal persist
- [ ] SYNC-03 — offline orders sync once, no duplicates

---

## 22. Defect reporting

For each Fail, capture: case ID, build/commit, device (tablet model + Android
version), steps to reproduce, expected vs actual, and a screenshot or the
relevant log (`preview_logs` / backend log / `read_console_messages`). File
against the owning app (`apps/backend`, `apps/frontend`, `apps/pos`).
