import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM encryption for integration credentials at rest (API keys, tokens,
 * webhook secrets). The 32-byte key comes from AGGREGATOR_ENCRYPTION_KEY via
 * ConfigService (never process.env directly — CLAUDE.md rule). Ciphertext format is
 * base64("iv(hex):authTag(hex):data(hex)"); the GCM auth tag makes tampering fail loudly.
 */
@Injectable()
export class CredentialEncryptionService {
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {}

  private get encryptionKey(): Buffer {
    const key = this.configService.get<string>('AGGREGATOR_ENCRYPTION_KEY');
    if (!key || key.length !== 32) {
      throw new Error(
        'AGGREGATOR_ENCRYPTION_KEY must be exactly 32 characters long',
      );
    }
    return Buffer.from(key, 'utf8');
  }

  /** Encrypt an object's JSON. Convenience wrapper over encrypt(). */
  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  /** Decrypt back to a typed object. Convenience wrapper over decrypt(). */
  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }

  /**
   * Encrypts a string (e.g. JSON stringified credentials).
   * Returns a base64 encoded string containing the IV, auth tag, and encrypted data.
   */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv,
    );

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    const payload = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    return Buffer.from(payload).toString('base64');
  }

  /**
   * Decrypts the payload back to the original string.
   */
  decrypt(encryptedPayload: string): string {
    const decoded = Buffer.from(encryptedPayload, 'base64').toString('utf8');
    const parts = decoded.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
