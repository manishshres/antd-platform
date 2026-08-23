/**
 * Phone-number normalisation for values handed to Telnyx.
 *
 * Telnyx's dial command requires +E164 and rejects anything else with a 422
 * ("The 'to' parameter must be a phone number in +E164 format"). Operators type these
 * into the provisioning wizard by hand — "2513158850", "(610) 352-2102", "1-610-352-2102"
 * are all natural things to write and all fail at call time, long after provisioning
 * reported success.
 */

/** Keys whose values are dialled, and so must be E164. */
const PHONE_KEY_PATTERN = /(phone|number|mobile|tel)/i;

/** A value already in E164: + followed by 8-15 digits, no leading zero. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Converts a loosely formatted number to +E164, or returns null when it cannot be done
 * confidently. Defaults to North America (+1) because that is the only region digit counts
 * alone can resolve unambiguously here — anything else keeps its original value rather
 * than being guessed into the wrong country.
 */
export function toE164(value: string): string | null {
  const trimmed = value.trim();
  if (E164.test(trimmed)) return trimmed;

  // Template placeholders like {{telnyx_end_user_target}} are resolved by Telnyx at call
  // time and must pass through untouched.
  if (trimmed.includes('{{')) return null;

  const digits = trimmed.replace(/[^\d]/g, '');

  // 10 digits is a North American number without its country code.
  if (digits.length === 10) return `+1${digits}`;
  // 11 digits starting with 1 is the same number with the country code, unprefixed.
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // A leading + was present and the digits are plausible — reattach it.
  if (trimmed.startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Returns a copy of `variables` with phone-shaped values normalised to E164. Values that
 * cannot be resolved confidently, and keys that are not phone numbers, are left alone.
 */
export function normalizePhoneVariables(
  variables: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = { ...variables };

  for (const [key, value] of Object.entries(variables)) {
    if (typeof value !== 'string' || !PHONE_KEY_PATTERN.test(key)) continue;
    const normalized = toE164(value);
    if (normalized) result[key] = normalized;
  }

  return result;
}
