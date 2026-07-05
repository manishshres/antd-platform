import { Request, Response } from 'express';

/**
 * Helpers for carrying the refresh token in an HttpOnly cookie instead of a JSON body the
 * frontend has to persist in localStorage (H2). Dependency-free: we set via Express'
 * `res.cookie` and read by parsing the raw `Cookie` header (no cookie-parser needed).
 */
export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Cookie path is '/' so the Next.js middleware (which runs server-side and can read HttpOnly
 * cookies) sees it on page navigations like /dashboard for its auth gate. It still reaches
 * /api/v1/auth/refresh. Scoping it to /api/v1/auth would hide it from page requests and cause
 * the middleware to bounce authenticated users back to /login.
 */
const REFRESH_COOKIE_PATH = '/';

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function setRefreshCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    // Lax works for same-site deployments (app + api on one registrable domain). A fully
    // cross-site SPA/API split would need SameSite=None; Secure.
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

/** Read the refresh token from the request cookie, if present. */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === REFRESH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
