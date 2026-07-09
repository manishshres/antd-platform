/**
 * Browser-safe JWT payload decoding (no verification — just reading claims).
 * Handles standard JWT Base64url encoding with proper padding replacement.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(
  token: string,
): T | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(
      window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as T;
    return decoded;
  } catch {
    return null;
  }
}

export function decodeRoleFromToken(token: string): string {
  const payload = decodeJwtPayload<{ role?: string }>(token);
  return payload?.role || "user";
}

export function getTokenExp(token: string): number | null {
  const payload = decodeJwtPayload<{ exp?: number }>(token);
  return typeof payload?.exp === "number" ? payload.exp : null;
}