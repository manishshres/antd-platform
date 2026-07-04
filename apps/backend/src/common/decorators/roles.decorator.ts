import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * @Roles(...roles) — specifies the roles allowed to access the route.
 * Must be combined with @UseGuards(JwtAuthGuard, RolesGuard).
 *
 * Usage:
 *   @Roles('admin', 'manager')
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   async adminOnlyMethod() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
