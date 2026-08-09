import { createPublicKey, verify as cryptoVerify } from 'crypto';

/**
 * Verifies a Telnyx webhook's Ed25519 signature.
 *
 * Telnyx signs `${timestamp}|${rawBody}` with Ed25519 and sends:
 *   - `telnyx-signature-ed25519`: base64 signature
 *   - `telnyx-timestamp`: unix seconds
 * The verifying public key (base64, raw 32-byte Ed25519) is issued in the Telnyx portal and
 * supplied via the `TELNYX_PUBLIC_KEY` env var.
 *
 * Node's crypto cannot build a public key from a raw Ed25519 key directly, so we wrap the
 * 32 raw bytes in the fixed 12-byte SPKI/DER prefix for Ed25519.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_SKEW_SECONDS = 5 * 60; // reject replayed events older than 5 minutes

export interface TelnyxSignatureInput {
  publicKeyBase64: string;
  signatureBase64: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer | string;
  /** Injectable for tests; defaults to now. */
  nowSeconds?: number;
}

export function verifyTelnyxSignature(input: TelnyxSignatureInput): boolean {
  const { publicKeyBase64, signatureBase64, timestamp, rawBody } = input;
  if (!publicKeyBase64 || !signatureBase64 || !timestamp) {
    return false;
  }

  // Reject stale or malformed timestamps to blunt replay attacks.
  if (!/^\d+$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

  try {
    const rawKey = Buffer.from(publicKeyBase64, 'base64');
    if (rawKey.length !== 32) return false;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
    const keyObject = createPublicKey({
      key: der,
      format: 'der',
      type: 'spki',
    });

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const signedPayload = Buffer.concat([Buffer.from(`${timestamp}|`), body]);
    const signature = Buffer.from(signatureBase64, 'base64');

    return cryptoVerify(null, signedPayload, keyObject, signature);
  } catch {
    return false;
  }
}
