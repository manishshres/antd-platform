import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

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
  private static readonly ROLE_HIERARCHY: Record<string, number> = {
    platform_admin: 100,
    sysadmin: 50,
    admin: 50,
    owner: 50,
    manager: 30,
    user: 10,
  };

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

    const userWeight = RolesGuard.ROLE_HIERARCHY[role.toLowerCase()] ?? 0;

    // Allow access if the user's role is equal to or higher than any of the required roles
    return requiredRoles.some((reqRole) => {
      const requiredWeight =
        RolesGuard.ROLE_HIERARCHY[reqRole.toLowerCase()] ?? 0;
      return userWeight >= requiredWeight;
    });
  }
}
