<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Call Center AI Frontend — Agent Guidelines (`antd-demo`)

Quick-reference rules for AI coding assistants. For detailed guidance, read `CLAUDE.md`.

---

## Documentation References

Always consult these vendor documentation files before implementing UI components:

- Ant Design LLM Guidelines
  https://ant.design/llms.txt

---

## Architecture

- **Framework**: Next.js 16 App Router + React 19 (TypeScript strict)
- **UI**: Ant Design v6 — `theme.useToken()` required for all style values
- **API**: ALL backend calls through `src/lib/api.ts` (Axios) → NestJS on `:4000`
- **Proxy**: `/api/v1/*` → `http://localhost:4000/api/v1/*` (next.config.ts rewrite)
- **No business logic** in the frontend — that lives in the backend

---

## ⚠️ Route guard — `src/proxy.ts`, NOT `middleware.ts`

In Next.js 16 the `middleware` file convention is **deprecated and renamed to
`proxy`** (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
The edge route guard lives in `src/proxy.ts`, which exports a function named
`proxy` plus the `config` matcher — this IS picked up and run by the framework.
Do not create a `middleware.ts`; it triggers a deprecation warning. The guard
redirects unauthenticated users (no `refresh_token` cookie) away from protected
paths; `DashboardLayout.tsx` provides a second, client-side gate.

---

## Visual Design System

- **Ant Design v6**: Use `theme.useToken()` for all layout values, borders, shadows, and colors.
  - This ensures automatic light/dark mode compatibility.
  - **Never** hardcode hex colors or pixel spacing values.
- **v6 Deprecations** — always use the new API:
  - `Drawer width` → `Drawer styles={{ wrapper: { width: 500 } }}` (`body` is for content padding; `wrapper` sets the panel width)
  - `Alert message` → `Alert title`
  - `Modal destroyOnClose` → `Modal destroyOnHidden`
  - `Spin tip` → `Spin description`
- **Loading States**: Use `Skeleton` (not generic spinners) during data fetching.

---

## Frontend Best Practices & Security

- **Error Boundaries**: Wrap major page sections in React Error Boundaries (`app/orders/error.tsx`).
- **Accessibility (a11y)**: All interactive elements must have `aria-label`. Use Ant Design `Form.Item label=` for form fields.
- **XSS Prevention**: Never use `dangerouslySetInnerHTML`.
- **Secrets**: Nothing sensitive in frontend env vars. Only `NEXT_PUBLIC_*` vars in client code — and these must be non-sensitive.
- **State Management**:
  - Local UI: `useState`, `useReducer`
  - Shared UI: React Context
  - Auth: `AuthContext` (wraps `DashboardLayout`)
  - Server data: Next.js Server Components caching or React Query for complex client-side data fetching
  - Never Redux unless explicitly required

---

## Strict Linting

Both must pass clean before committing:

```bash
npm run lint    # ESLint 9 flat config — zero warnings
npm run build   # TypeScript + ESLint + bundle
```

---

## Forbidden Patterns

| ❌ Never                                      | ✅ Instead                          |
|-----------------------------------------------|-------------------------------------|
| `fetch('https://telnyx...')`                  | `api.get('/calls')`                 |
| `#1677ff` or hardcoded colors                 | `token.colorPrimary`                |
| `dangerouslySetInnerHTML`                      | Safe rendering / server sanitization|
| Business logic in components                  | Move to backend service             |
| `app/api/*` new route handlers                | These are LEGACY — don't add more   |
| `any` TypeScript type                         | Explicit types                      |
| `process.env.SECRET_KEY` in components        | Only `NEXT_PUBLIC_*` in client code |
