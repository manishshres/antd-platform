import { generateKeyPairSync, sign as edSign, KeyObject } from 'crypto';
import { verifyTelnyxSignature } from './telnyx-signature';

/** Extract the raw 32-byte Ed25519 public key (last 32 bytes of the SPKI DER). */
function rawPublicKeyBase64(publicKey: KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}

describe('verifyTelnyxSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBase64 = rawPublicKeyBase64(publicKey);
  const now = 1_700_000_000;

  function signedFor(body: string, timestamp: number): string {
    const payload = Buffer.from(`${timestamp}|${body}`);
    return edSign(null, payload, privateKey).toString('base64');
  }

  it('accepts a correctly signed, fresh payload', () => {
    const body = JSON.stringify({ data: { id: 'evt_1' } });
    const signatureBase64 = signedFor(body, now);

    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64,
        timestamp: String(now),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signatureBase64 = signedFor('{"data":{"id":"evt_1"}}', now);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64,
        timestamp: String(now),
        rawBody: '{"data":{"id":"evt_TAMPERED"}}',
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const body = '{"data":{"id":"evt_1"}}';
    const signatureBase64 = signedFor(body, now - 3600);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64,
        timestamp: String(now - 3600),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a missing signature or timestamp', () => {
    const body = '{"data":{"id":"evt_1"}}';
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: undefined,
        timestamp: String(now),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const other = generateKeyPairSync('ed25519');
    const body = '{"data":{"id":"evt_1"}}';
    const badSig = edSign(
      null,
      Buffer.from(`${now}|${body}`),
      other.privateKey,
    ).toString('base64');
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: badSig,
        timestamp: String(now),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
