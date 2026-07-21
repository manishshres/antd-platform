/**
 * Fail-fast environment validation.
 *
 * Runs once at bootstrap via `ConfigModule.forRoot({ validate })`. Missing critical secrets
 * throw here instead of silently falling back to insecure defaults (e.g. a hardcoded JWT
 * secret) that would make every token forgeable in a misconfigured deployment.
 */

/** Secrets that must always be present, in every environment. */
const ALWAYS_REQUIRED = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

/** Secrets additionally required when NODE_ENV=production. */
const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'FRONTEND_URL',
  'STRIPE_WEBHOOK_SECRET',
  // AES-256-GCM key for encrypting marketplace integration credentials at rest.
  'AGGREGATOR_ENCRYPTION_KEY',
] as const;

const MIN_SECRET_LENGTH = 16;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const isProd = config.NODE_ENV === 'production';
  const required = [
    ...ALWAYS_REQUIRED,
    ...(isProd ? REQUIRED_IN_PRODUCTION : []),
  ];

  const missing: string[] = [];
  const weak: string[] = [];

  for (const key of required) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(key);
      continue;
    }
    // Guard against leftover placeholder / obviously weak secrets.
    if (
      (key === 'JWT_SECRET' || key === 'JWT_REFRESH_SECRET') &&
      (value.length < MIN_SECRET_LENGTH ||
        value.includes('change-in-production'))
    ) {
      weak.push(key);
    }
    // AES-256 requires a key of exactly 32 bytes (CredentialEncryptionService).
    if (key === 'AGGREGATOR_ENCRYPTION_KEY' && value.length !== 32) {
      weak.push(`${key} (must be exactly 32 characters)`);
    }
  }

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (weak.length > 0) {
    problems.push(
      `Weak/placeholder secrets (need >= ${MIN_SECRET_LENGTH} chars, no placeholder text): ${weak.join(
        ', ',
      )}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Environment validation failed:\n  - ${problems.join('\n  - ')}`,
    );
  }

  return config;
}
