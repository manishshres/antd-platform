/**
 * In-memory access token store.
 *
 * Access tokens are kept in a closure variable rather than localStorage to prevent
 * exfiltration via XSS. The HttpOnly refresh_token cookie is the persistence mechanism;
 * on page load, the refresh endpoint re-issues a new access token.
 */

let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const fn of listeners) fn(token);
}

export function onTokenChange(fn: (token: string | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearAccessToken(): void {
  setAccessToken(null);
}