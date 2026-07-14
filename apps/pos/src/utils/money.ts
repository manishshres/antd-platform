/** Format integer cents as a currency string, e.g. 2400 -> "$24.00". */
export function formatMoney(cents: number | null | undefined): string {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars.toLocaleString('en-US')}.${rem}`;
}

/** Parse a user-typed dollar amount ("12.5", "$12.50") into cents; NaN-safe. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/**
 * Discount in cents, never exceeding the subtotal — must mirror the backend's
 * OrderPricingService.discountAmountFor exactly so an offline receipt matches
 * what the server prices on sync.
 */
export function discountAmountFor(
  discount: { type: string; value: number } | null,
  subtotal: number,
): number {
  if (!discount) return 0;
  const raw =
    discount.type === 'percent'
      ? Math.round((subtotal * discount.value) / 100)
      : discount.value;
  return Math.min(subtotal, Math.max(0, raw));
}

/** Tax in cents from a basis-points rate, matching the backend's rounding. */
export function taxFor(taxableBase: number, taxRateBps: number): number {
  return Math.round((taxableBase * taxRateBps) / 10000);
}
