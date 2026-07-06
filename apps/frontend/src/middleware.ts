import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Add paths that require authentication here
const protectedPaths = [
  '/dashboard',
  '/orders',
  '/menus',
  '/printers',
  '/analytics',
  '/audit',
  '/users',
  '/settings',
  '/profile',
  '/calls',
  '/platform-admin',
  '/admin',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if it's a protected path
  const isProtectedPath = protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtectedPath) {
    // We check for refresh_token cookie set by the backend
    const hasRefreshToken = request.cookies.has('refresh_token');

    if (!hasRefreshToken) {
      // Redirect to login if no refresh token is present
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  // NOTE: do NOT bounce /login → /dashboard based on cookie presence. The refresh_token
  // cookie is HttpOnly, so the client can't remove it when the session dies server-side
  // (rotated/revoked token) — bouncing here created an infinite /login ↔ /dashboard loop.
  // The login page itself redirects users who still hold a valid access token.

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
