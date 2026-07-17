import { ConfigService } from '@nestjs/config';
import { CredentialEncryptionService } from './credential-encryption.service';

function serviceWithKey(key: string | undefined): CredentialEncryptionService {
  const config = {
    get: (name: string) =>
      name === 'AGGREGATOR_ENCRYPTION_KEY' ? key : undefined,
  } as unknown as ConfigService;
  return new CredentialEncryptionService(config);
}

const VALID_KEY = '0123456789abcdef0123456789abcdef'; // exactly 32 chars

describe('CredentialEncryptionService', () => {
  it('round-trips a string', () => {
    const svc = serviceWithKey(VALID_KEY);
    const secret = 'super-secret-token';
    const encrypted = svc.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(svc.decrypt(encrypted)).toBe(secret);
  });

  it('round-trips JSON credentials', () => {
    const svc = serviceWithKey(VALID_KEY);
    const creds = { clientId: 'a', clientSecret: 'b', webhookSecret: 'c' };
    const encrypted = svc.encryptJson(creds);
    expect(svc.decryptJson(encrypted)).toEqual(creds);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const svc = serviceWithKey(VALID_KEY);
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('fails to decrypt tampered ciphertext (GCM auth tag)', () => {
    const svc = serviceWithKey(VALID_KEY);
    const encrypted = svc.encrypt('hello');
    const raw = Buffer.from(encrypted, 'base64').toString('utf8');
    const [iv, tag, data] = raw.split(':');
    const flipped = data.slice(0, -1) + (data.endsWith('0') ? '1' : '0');
    const tampered = Buffer.from(`${iv}:${tag}:${flipped}`).toString('base64');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('rejects a missing or wrong-length key', () => {
    expect(() => serviceWithKey(undefined).encrypt('x')).toThrow();
    expect(() => serviceWithKey('too-short').encrypt('x')).toThrow();
  });
});
