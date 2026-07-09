# CLAUDE.md — antd-demo (Next.js SaaS Frontend)

This file provides comprehensive guidance for AI coding assistants and human developers working on the `antd-demo` project.

> **@AGENTS.md** — see `AGENTS.md` for quick-reference rules.
> **Ant Design Specification**: Refer to the official [Ant Design LLM Guidelines](https://ant.design/llms.txt) for component semantic styling APIs.

---

## 🧠 System Overview

This frontend is the **pure SaaS UI layer** for the Call Center AI Platform.

- Built with Next.js 16 (App Router) and React 19 (Server Components by default)
- Uses Ant Design v6 for all UI components
- Communicates **only** with the NestJS backend via Axios (`src/lib/api.ts`)
- Contains **zero** business logic — that all lives in the backend

**Backend URL (local dev)**:
```
/api/v1/* → http://localhost:4000/api/v1/* (via next.config.ts rewrite)
```

**Backend URL (production)**:
```
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

---

## 🧱 Technology Stack

| Layer             | Technology                           | Notes                                      |
|-------------------|--------------------------------------|--------------------------------------------|
| Framework         | Next.js 16 (App Router)              | `app/` directory, React Server Components  |
| UI Library        | React 19                             | `"use client"` only when needed            |
| Component Library | Ant Design v6                        | Theme tokens for light/dark mode           |
| HTTP Client       | Axios (`src/lib/api.ts`)             | JWT interceptors, all backend calls        |
| Styling           | Ant Design tokens + inline styles    | No TailwindCSS. No raw hex colors.         |
| Icons             | `@ant-design/icons` v6               |                                            |
| Audio             | wavesurfer.js v7                     | Call recording waveform player             |
| Dates             | dayjs                                 | Approved date library — don't add moment.js or date-fns alongside it |
| Language          | TypeScript (strict)                  | All DTOs in `src/types/`                   |
| Linting           | ESLint 9 (flat config) + Prettier    | Zero warnings policy                       |

---

## 📁 Project Structure

```
antd-demo/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — AntdRegistry + theme provider
│   │   ├── page.tsx                # Redirects → /dashboard (if auth) or /login
│   │   ├── globals.css             # Minimal global CSS — prefer Ant Design tokens
│   │   ├── error.tsx               # [PLANNED] Root error boundary (React Error Boundary)
│   │   ├── not-found.tsx           # 404 page
│   │   ├── login/
│   │   │   └── page.tsx            # JWT login — no sidebar layout
│   │   ├── register/
│   │   │   └── page.tsx            # Registration — no sidebar layout
│   │   ├── dashboard/
│   │   │   ├── page.tsx            # KPI overview cards, recent orders, call stats
│   │   │   └── loading.tsx         # [PLANNED] Skeleton loader
│   │   ├── assistant/
│   │   │   ├── page.tsx            # Voice AI agent list
│   │   │   └── [id]/page.tsx       # Agent detail + configuration editor
│   │   ├── calls/
│   │   │   ├── page.tsx            # Call history list with filters
│   │   │   └── [id]/page.tsx       # Call detail: waveform, transcript, metadata
│   │   ├── menus/
│   │   │   └── page.tsx            # Tab-grouped categories, items, import from website
│   │   ├── orders/
│   │   │   └── page.tsx            # Order list, status management, mock generator
│   │   ├── pos/
│   │   │   ├── page.tsx            # In-store register: category rail, item grid, cart, tender/payment, table picker
│   │   │   └── components/
│   │   ├── billing/
│   │   │   └── page.tsx            # Plan details, usage meters, Stripe redirect
│   │   ├── documentation/
│   │   │   └── page.tsx            # Knowledge base / document management
│   │   ├── printers/                # Printer management dashboard
│   │   │   └── page.tsx
│   │   ├── users/                   # Admin: user CRUD, roles, permissions
│   │   │   └── page.tsx
│   │   ├── audit/                   # Admin: audit log viewer
│   │   │   └── page.tsx
│   │   └── settings/                # Organization settings, incl. settings/locations, settings/floor-plans
│   │       └── page.tsx
│   ├── components/
│   │   ├── DashboardLayout.tsx     # Shell: sidebar + header + content + auth guard
│   │   ├── PageHeader.tsx          # Standard page title/subtitle/actions header
│   │   ├── PageStates.tsx          # EmptyState / ErrorState shared components
│   │   ├── TransactionDrawer.tsx       # Single-order detail: items, status actions, print
│   │   ├── TransactionsListDrawer.tsx  # Transactions hub: date range, live summary, open/closed, source filters
│   │   ├── ErrorBoundary.tsx       # [PLANNED] React Error Boundary wrapper
│   │   ├── PageSkeleton.tsx        # [PLANNED] Reusable skeleton loader for data pages
│   │   └── [feature]/              # Feature-specific components
│   ├── lib/
│   │   ├── api.ts                  # ← Axios client. ALL backend calls go through here
│   │   └── auth.ts                 # Token read/write from localStorage or cookie
│   └── types/
│       ├── api.ts                  # Shared API types (Pagination, ApiError)
│       ├── auth.ts                 # User, LoginResponse, RegisterResponse
│       ├── agent.ts                # VoiceAgent
│       ├── call.ts                 # CallRecord, Transcript
│       ├── menu.ts                 # Category, MenuItem
│       ├── order.ts                # Order, OrderItem, OrderStatus
│       ├── printer.ts              # [PLANNED] Printer, PrintJob
│       └── billing.ts             # Plan, Subscription, UsageMetrics
├── public/
├── next.config.ts                  # API proxy rewrite rule
├── tsconfig.json                   # Path alias: @/* → ./src/*
├── .env.local                      # Local env (not committed)
├── .env.example                    # Committed — lists required vars
├── AGENTS.md
├── CLAUDE.md
└── ROADMAP.md
```

---

## 🌐 API Client Rules

**The single most important rule**: all backend calls go through `src/lib/api.ts`.

```typescript
// src/lib/api.ts
import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  withCredentials: true,
});

// Auto-attach JWT access token
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

// Handle 401 → redirect to login
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### Rules

1. **Never** use `fetch()` directly in a component.
2. **Never** call an external API (Telnyx, Stripe, MQTT) from the frontend.
3. **Never** store secrets in the frontend — they belong in the backend `.env`.
4. API calls from `"use client"` components use `api.ts`.
5. API calls from Server Components use a server-side Axios instance with proper auth headers.

---

## 🔐 Authentication Flow

```
User submits /login form
  → POST /api/v1/auth/login
  → Backend returns { accessToken, user }
  → Store accessToken in localStorage (or memory for better security)
  → Redirect to /dashboard

On every route render:
  DashboardLayout.tsx checks for token
  → If missing → redirect to /login
  ⚠️ This is currently the ONLY auth gate — see "Known Issue" in AGENTS.md:
  the edge-middleware route guard (src/middleware.ts → renamed src/proxy.ts)
  is not wired up and does nothing. Don't assume unauthenticated requests are
  blocked before a page renders.

Proactive refresh (src/lib/api.ts):
  → A timer fires ~5 min before the access token's JWT `exp`
  → Silently calls POST /api/v1/auth/refresh and swaps the stored token
  → Keeps idle users logged in without ever hitting a 401

Reactive refresh (safety net, when the proactive timer is missed):
  → A request gets a 401
  → POST /api/v1/auth/refresh (sends HTTP-only refresh cookie)
  → Store new accessToken
  → Retry original request
```

### Auth Pages

- `/login`, `/register` — bypass `DashboardLayout` (no sidebar)
- `/forgot-password` — sends email via `POST /auth/forgot-password`
- `/reset-password?token=xxx` — submits via `POST /auth/reset-password`

---

## 🎨 Ant Design v6 — Design System Rules

### Mandatory

1. Use `theme.useToken()` for **all** color, spacing, border, and shadow values.
2. **Never** hardcode hex colors, pixel values for spacing, or `border-radius` manually.
3. Light/dark mode compatibility must be automatic from tokens — no manual `color-scheme` hacks.

```typescript
// ✅ Correct
const { token } = theme.useToken();
<div style={{ background: token.colorBgContainer, borderRadius: token.borderRadius }} />

// ❌ Forbidden
<div style={{ background: '#ffffff', borderRadius: 8 }} />
```

### Ant Design v6 Deprecations — Use New APIs

| Deprecated Prop        | New Prop                    |
|------------------------|-----------------------------|
| `Drawer width={500}`   | `Drawer styles={{ body: { width: 500 } }}` |
| `Alert message={...}`  | `Alert title={...}`         |
| `Modal destroyOnClose` | `Modal destroyOnHidden`     |
| `Spin tip={...}`       | `Spin description={...}`    |

### Loading States

Always use Ant Design `Skeleton` components (not generic spinners) during data fetching:
```typescript
if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;
```

---

## 🧩 Component Architecture

### Server vs Client Components

| Component Type         | Directive       | Examples                                          |
|------------------------|-----------------|---------------------------------------------------|
| Layout wrappers        | Server (default)| `layout.tsx`, `not-found.tsx`                     |
| Static info pages      | Server (default)| Simple text/markdown pages                        |
| Interactive data pages | `"use client"`  | All dashboard pages (tables, forms, modals, charts)|
| State-using hooks      | `"use client"`  | Anything using `useState`, `useEffect`, Ant Design hooks |

### Error Boundaries

Wrap every major page section in an Error Boundary to prevent cascade failures:
```typescript
// app/orders/page.tsx
export default function OrdersPage() {
  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <OrdersContent />
    </ErrorBoundary>
  );
}
```

Or use Next.js file-based Error Boundaries:
```
app/orders/error.tsx   ← handles errors in this route segment
app/error.tsx          ← root-level catch-all
```

### State Management

| Scope               | Solution                              |
|---------------------|---------------------------------------|
| Component-local UI  | `useState`, `useReducer`              |
| Cross-component UI  | React Context                         |
| Server data fetching| Server Components + Next.js caching   |
| Client data fetching| React Query / SWR (future preference) |
| Global auth state   | React Context (`AuthContext`)         |

**Never** use Redux or heavy global state managers unless the complexity explicitly requires it.

---

## 📡 API Type Definitions

All backend response shapes must be typed in `src/types/`. DTOs should mirror the backend.

```typescript
// src/types/order.ts
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  totalAmount: number;  // in cents
  items: OrderItem[];
  createdAt: string;    // ISO 8601
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;        // in cents
}
```

---

## ♿ Accessibility (a11y) Requirements

- All interactive elements (`Button`, `Input`, custom components) must have meaningful `aria-label` attributes.
- Maintain WCAG AA contrast ratios (Ant Design tokens handle this by default).
- All form fields must have associated `<label>` (use Ant Design `Form.Item label=`).
- Modal dialogs must trap focus and be dismissible by `Esc` key (Ant Design handles this).
- Data tables must use `aria-label` on the `<Table>` component.
- Color must not be the only indicator of status — pair color with icon or text.

---

## 🔒 Security Requirements

- **XSS Prevention**: Never use `dangerouslySetInnerHTML` unless the content is strictly sanitized server-side.
- **Token Storage**: Prefer HTTP-only cookies for refresh tokens (handled by backend). Access tokens in `localStorage` are acceptable for short TTL (15 min).
- **No secrets in frontend**: API keys, SMTP credentials, etc. must never appear in client-side code or environment variables prefixed with `NEXT_PUBLIC_`.
- **CSRF**: Backend handles CSRF for cookie sessions.
- **CSP**: Set Content Security Policy headers from the backend or via Next.js `headers()` in `next.config.ts`.

---

## 🏗️ Coding Conventions

### File & Folder Naming

| Type                | Convention    | Example                         |
|---------------------|---------------|---------------------------------|
| Pages               | `page.tsx`    | `app/orders/page.tsx`           |
| Components          | `PascalCase`  | `OrderDrawer.tsx`               |
| Utilities / hooks   | `camelCase`   | `useOrderStatus.ts`             |
| Types               | `PascalCase`  | `OrderItem`                     |
| CSS modules         | `kebab-case`  | `order-table.module.css`        |
| Import aliases      | `@/`          | `@/components/DashboardLayout`  |

### Import Order (enforced by ESLint)

1. React / Next.js framework imports
2. Third-party libraries (Ant Design, Axios, etc.)
3. Internal `@/` path alias imports
4. Relative imports
5. Type-only imports (`import type { ... }`)

### Component Pattern

```typescript
"use client";

import { useState } from 'react';
import { Button, Table } from 'antd';
import { theme } from 'antd';
import type { Order } from '@/types/order';
import { api } from '@/lib/api';

interface Props {
  organizationId: string;
}

export default function OrdersPage({ organizationId }: Props) {
  const { token } = theme.useToken();
  const [orders, setOrders] = useState<Order[]>([]);
  // ...
}
```

---

## 🧪 Testing Requirements

```bash
# Run all tests
npm run test

# Lint (must pass clean)
npm run lint

# Production build (validates TypeScript)
npm run build
```

### Testing Guidelines

- Unit test utility functions in `src/lib/`
- Component tests with React Testing Library for critical UI flows (login form, order status update)
- No snapshot tests — prefer behavior tests

---

## 🔄 Development Workflow

### Daily Commands

```bash
# Make sure backend is running on :4000 first
cd ~/Projects/antd-backend && npm run dev

# Start frontend
npm run dev               # http://localhost:3000 — runs `next dev --webpack` (Turbopack opted out)

# Before committing:
npm run lint              # must pass with 0 warnings
npm run build             # must compile cleanly
```

### Environment Variables

```env
# .env.local (not committed)
NEXT_PUBLIC_API_URL=      # empty = use local proxy (/api/v1 → localhost:4000)
```

For production:
```env
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

### Proxy (Local Dev)

Configured in `next.config.ts`:
```typescript
rewrites: async () => [
  { source: '/api/v1/:path*', destination: 'http://localhost:4000/api/v1/:path*' }
]
```

In production, replace with a real domain — remove the rewrite.

---

## 🚫 Forbidden Patterns

| ❌ Never                                        | ✅ Instead                                      |
|-------------------------------------------------|-------------------------------------------------|
| `fetch('https://api.telnyx.com/...')`           | Use `api.get('/calls')` through the backend     |
| Hardcoded hex colors `#1677ff`                  | `token.colorPrimary`                            |
| Raw `process.env.SECRET_KEY` in components      | Only `NEXT_PUBLIC_*` vars in client code        |
| `dangerouslySetInnerHTML`                       | Sanitize server-side or use safe rendering      |
| Business logic in React components              | Move to backend service or a utility in `lib/`  |
| Redux for simple UI state                       | `useState` or React Context                     |
| `any` TypeScript type                           | Explicit types or type assertions               |
| API route handlers in `app/api/*`               | These are LEGACY — do not add new ones          |

---

## 🚀 Deployment

### Production Build

```bash
npm run build    # TypeScript + ESLint validation + bundle
npm run start    # Serve the built app
```

### Environment Variables Required in Production

```env
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

### Hosting

- Recommended: Vercel (zero-config for Next.js)
- Alternative: Docker with `next start`

### SEO Requirements (Every Page)

Every page must have:
```typescript
export const metadata: Metadata = {
  title: 'Orders — Call Center AI',
  description: 'Manage and track restaurant orders in real time.',
};
```

---

## 📋 Architecture Notes

### Two-Repo Topology

```
~/Projects/
  antd-demo/       ← this repo (Next.js 16 frontend @ :3000)
  antd-backend/    ← sibling repo (NestJS 11 backend @ :4000)
```

These repos communicate exclusively via HTTP. The frontend never imports from the backend.

### Key Dependencies

| Package                    | Version | Purpose                            |
|----------------------------|---------|------------------------------------|
| `next`                     | 16.x    | App Router framework               |
| `react`                    | 19.x    | Server Components default          |
| `antd`                     | 6.x     | Component library                  |
| `@ant-design/icons`        | 6.x     | Icon set                           |
| `@ant-design/nextjs-registry` | 1.x  | SSR style hydration for Ant Design |
| `axios`                    | 1.x     | HTTP client                        |
| `wavesurfer.js`            | 7.x     | Call recording waveform visualizer |
| `dayjs`                    | 1.x     | Date range logic (e.g. Transactions hub filters) |