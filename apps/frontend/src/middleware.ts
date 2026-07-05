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

  // Prevent authenticated users from visiting the login/register pages
  if (pathname === '/login' || pathname === '/register') {
    const hasRefreshToken = request.cookies.has('refresh_token');
    if (hasRefreshToken) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

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
