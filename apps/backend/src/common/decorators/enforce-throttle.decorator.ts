import { SetMetadata } from '@nestjs/common';

export const ENFORCE_THROTTLE_KEY = 'enforceThrottle';

/**
 * @EnforceThrottle() — keeps a route rate-limited while the global throttle switch
 * (`THROTTLE_ENABLED`) is off.
 *
 * Rate limiting is currently disabled platform-wide so the Voice AI call flow isn't
 * clipped by the IP-keyed webhook limits. The two credential-guessing surfaces still
 * need a bound, so they opt back in: the `/auth` routes (password login) and the POS
 * PIN routes. Everything else stays unlimited until `THROTTLE_ENABLED=true`.
 *
 * Read by the `skipIf` in `AppModule`'s ThrottlerModule options; class-level metadata
 * covers every route in the controller.
 */
export const EnforceThrottle = () => SetMetadata(ENFORCE_THROTTLE_KEY, true);
