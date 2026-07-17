import { redactSensitiveFields, SENSITIVE_FIELDS } from './redact-sensitive';

/**
 * Unit tests for the body-redaction helper used before forwarding request
 * bodies to Sentry. The helper sits behind the `GlobalExceptionFilter`'s
 * BadRequestException-capture branch; testing it directly avoids the
 * complexity of stubbing `@sentry/node` (whose namespace imports are
 * non-configurable after first import in the same Jest module cache).
 */
describe('redactSensitiveFields', () => {
  it('masks password fields', () => {
    const redacted = redactSensitiveFields({
      email: 'a@b.c',
      password: 'hunter2',
    });
    expect(redacted).toMatchObject({
      email: 'a@b.c',
      password: '***',
    });
  });

  it('masks nested refreshToken under a `nested` key', () => {
    const redacted = redactSensitiveFields({
      nested: { refreshToken: 'r1' },
    });
    expect(
      (redacted as { nested: Record<string, string> }).nested.refreshToken,
    ).toBe('***');
  });

  it('masks x-api-key and authorization fields', () => {
    const redacted = redactSensitiveFields({
      'x-api-key': 'coai_live_abc',
      authorization: 'Bearer eyJ',
    });
    expect(redacted).toMatchObject({
      'x-api-key': '***',
      authorization: '***',
    });
  });

  it('preserves non-credential fields verbatim', () => {
    const redacted = redactSensitiveFields({
      name: 'Tina',
      customerId: 'cust-123',
      nested: { phone: '+15551234567' },
    }) as Record<string, unknown>;
    expect(redacted.name).toBe('Tina');
    expect(redacted.customerId).toBe('cust-123');
    expect((redacted.nested as Record<string, string>).phone).toBe(
      '+15551234567',
    );
  });

  it('walks arrays recursively', () => {
    const redacted = redactSensitiveFields([
      { password: 'p1', name: 'row1' },
    ]) as Array<Record<string, string>>;
    expect(redacted[0].password).toBe('***');
    expect(redacted[0].name).toBe('row1');
  });

  it('does not crash on primitive bodies (null, string, undefined)', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields('plain string')).toBe('plain string');
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields(42)).toBe(42);
  });

  it('uses case-insensitive substring matching against the allow-list', () => {
    const redacted = redactSensitiveFields({
      PasswordHash: 'pw',
      AuthorizationToken: 'a',
      StRoNg_passCODE: 'b',
      innocuous: 'leave alone',
    }) as Record<string, string>;
    expect(redacted.PasswordHash).toBe('***');
    expect(redacted.AuthorizationToken).toBe('***');
    expect(redacted.StRoNg_passCODE).toBe('***');
    expect(redacted.innocuous).toBe('leave alone');
  });

  it('exposes the SENSITIVE_FIELDS list as a frozen-shape tuple export', () => {
    expect(Array.isArray(SENSITIVE_FIELDS)).toBe(true);
    expect(SENSITIVE_FIELDS).toContain('password');
    expect(SENSITIVE_FIELDS).toContain('token');
    expect(SENSITIVE_FIELDS).toContain('authorization');
    expect(SENSITIVE_FIELDS).toContain('x-api-key');
  });
});
