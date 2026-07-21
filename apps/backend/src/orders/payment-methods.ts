/** Tender types the POS can record. Payment processing itself always happens outside the app. */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'gift_card',
  'store_credit',
  'other',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
