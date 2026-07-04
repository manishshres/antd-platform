import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * @Public() — marks a route as publicly accessible, skipping JwtAuthGuard.
 *
 * Usage:
 *   @Public()
 *   @Post('register')
 *   async register(...) { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
