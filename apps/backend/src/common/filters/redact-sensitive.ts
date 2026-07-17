/**
 * Strip the obvious credential fields off an in-memory payload before we
 * forward it to a logging/observability sink. Anything matching any of
 * `SENSITIVE_FIELDS` as a case-insensitive substring gets replaced with `'***'`.
 *
 * Walking recursively matters because:
 *  - login bodies nest `refreshToken` inside `data`
 *  - axios/fetch wrappers sometimes JSON-encode twice, leaving arrays of objects
 *  - form-encoded bodies are flat, but JSON bodies are tree-shaped
 *  - the upstream caller might pass `null` / `undefined` / a string
 *    (e.g. raw email payload) — those short-circuit.
 */
export const SENSITIVE_FIELDS = [
  'password',
  'pass',
  'token',
  'refresh',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'x-api-key',
  'pin',
] as const;

export function redactSensitiveFields(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveFields(item));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some((s) =>
      lower.includes(s.toLowerCase()),
    );
    out[k] = isSensitive ? '***' : redactSensitiveFields(v);
  }
  return out;
}
