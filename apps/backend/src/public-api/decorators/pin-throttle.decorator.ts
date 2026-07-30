import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiKeyThrottlerGuard } from '../../webhooks/api-key-throttler.guard';

/** Failed-PIN ceiling per register per minute. */
export const PIN_THROTTLE_LIMIT = 10;
export const PIN_THROTTLE_TTL_MS = 60_000;

/**
 * Rate-limits POS PIN entry (N3).
 *
 * `PublicEmployeesController` is `@SkipThrottle()` as a whole — the register polls its
 * other endpoints constantly and must not be throttled — which left the PIN routes with
 * no limit at all. A 4-digit PIN is 10,000 guesses, so an authenticated-but-junior
 * session could walk the whole space in seconds. This re-enables throttling for the PIN
 * routes only, keyed on the API key (one register) rather than IP, since a whole
 * restaurant commonly shares one egress IP.
 *
 * This is the only bound on the org-wide branch of `verifyManagerPin`, which has no single
 * user to count failures against; the per-user lockout in `UsersService` covers the rest.
 */
export const PinThrottle = () =>
  applyDecorators(
    SkipThrottle({ default: false }),
    Throttle({
      default: { limit: PIN_THROTTLE_LIMIT, ttl: PIN_THROTTLE_TTL_MS },
    }),
    UseGuards(ApiKeyThrottlerGuard),
  );
