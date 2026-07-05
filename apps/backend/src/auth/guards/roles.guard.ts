import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ROLE_HIERARCHY, type UserRole } from '../../common/constants/roles';

/**
 * RolesGuard — enforces role-based access control.
 * Must be used AFTER JwtAuthGuard (relies on req.user being set).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('admin', 'manager')
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    const user = request.user;
    if (!user) {
      return false;
    }
    const role = user.role;
    if (!role) {
      return false;
    }

    const weightOf = (r: string): number =>
      ROLE_HIERARCHY[r.toLowerCase() as UserRole] ?? 0;
    const userWeight = weightOf(role);

    // Allow access if the user's role is equal to or higher than any of the required roles
    return requiredRoles.some((reqRole) => userWeight >= weightOf(reqRole));
  }
}
