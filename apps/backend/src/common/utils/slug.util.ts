import { randomBytes } from 'crypto';

/**
 * Generates a URL-safe slug from a name with a random hex suffix
 * to ensure uniqueness.
 *
 * Example: "Philadelphia Store" → "philadelphia-store-a3b1c9d2"
 *
 * @param name - The human-readable name to slugify
 * @returns A unique slug string
 */
export function generateUniqueSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base}-${randomBytes(4).toString('hex')}`;
}
