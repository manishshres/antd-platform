# AGENTS.md — antd-pos (Expo tablet POS)

Expo SDK 57 app — the API surface has changed across SDK majors; check the
exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before using
an unfamiliar Expo API.

## What this app is

Offline-first restaurant register for tablets in **landscape**. Built with
React Native Paper, themed with the default Ant Design palette (`src/theme.ts`,
4px `RADIUS` everywhere). It talks **only** to the backend's public API
(`/api/v2/*`, `x-api-key` header) — never the JWT `/api/v1` routes.

## Architecture

- `src/theme.ts` — Ant Design palette + Paper MD3 theme. Use `antd.*` colors
  and `RADIUS`; never hard-code hex values in screens.
- `src/api/client.ts` — typed public-API client. `ApiNetworkError` means
  "offline, retry later"; `ApiRequestError` (4xx) means "really rejected".
- `src/db/` — expo-sqlite cache + queue (`database.ts` schema, repos per
  domain). All money is **integer cents**, matching the backend.
- `src/sync/syncEngine.ts` — push queued orders (idempotent: the local order
  UUID is sent as `clientOrderId`) and dirty customers, then pull
  catalog/customers/tables/locations. Triggered by NetInfo reconnect, an
  interval, or "Sync Now".
- `src/state/` — `AppContext` (settings, connectivity, sync state,
  `dataVersion` bump after each sync), `CartContext` (current order).
- `src/screens/` + `src/components/` — one file per screen; navigation is a
  simple `ScreenName` switch in `App.tsx` (sidebar layout, no react-navigation).

## Rules

- Screens read SQLite only (except order history, which prefers the server
  when online and falls back to local). Never block the UI on a network call.
- Orders are priced server-side on sync; local totals must mirror the backend
  math (`taxFor` — round(base × bps / 10000)).
- New local writes that must reach the server get a queue status + retry path
  through the sync engine, never a fire-and-forget fetch.
- `npx tsc --noEmit` must pass; verify bundling with
  `npx expo export --platform android`.
