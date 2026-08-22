import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ENFORCE_THROTTLE_KEY } from './decorators/enforce-throttle.decorator';

/**
 * Builds the `skipIf` handed to `ThrottlerModule` — the master switch for rate limiting.
 *
 * `skipIf` runs inside `ThrottlerGuard.canActivate` before any limit is resolved, and
 * route-level `@Throttle()` only overrides limit/ttl, so this one predicate governs every
 * throttled route: the Telnyx / AI-order / aggregator webhooks, the `/auth` routes and the
 * POS PIN routes.
 *
 * Throttling is currently OFF by default (`THROTTLE_ENABLED` unset) because the Telnyx
 * webhook limit is IP-keyed and Telnyx delivers every tenant's call events from one small
 * egress pool — a few concurrent Voice AI calls could 429 and drop call state. Routes
 * marked {@link ENFORCE_THROTTLE_KEY} via `@EnforceThrottle()` stay limited anyway, since
 * password login and PIN entry are credential-guessing surfaces that always need a bound.
 */
export function createThrottleSkipIf(
  configService: ConfigService,
  reflector: Reflector = new Reflector(),
): (context: ExecutionContext) => boolean {
  return (context: ExecutionContext) => {
    if (configService.get<string>('THROTTLE_ENABLED', 'false') === 'true') {
      return false;
    }
    return !reflector.getAllAndOverride<boolean>(ENFORCE_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  };
}
