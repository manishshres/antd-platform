import type { Viewport } from "next";

// The POS register is a fixed, kiosk-style touch surface — pinch-zoom would break the
// register layout. Viewport restrictions are scoped to this segment (Server Component
// layout) rather than the root, so zoom stays enabled everywhere else (WCAG 1.4.4).
// `viewport`/`metadata` exports are only valid in Server Components, which is why this
// lives here and not in the `"use client"` page.
export const viewport: Viewport = {
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
