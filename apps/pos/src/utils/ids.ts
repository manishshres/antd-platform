import * as Crypto from 'expo-crypto';

/** RFC-4122 v4 UUID; used for local order ids / server idempotency keys. */
export function newId(): string {
  return Crypto.randomUUID();
}
