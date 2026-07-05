/**
 * Single source of truth for user roles (M4). Previously the role taxonomy was duplicated and
 * drifted across the DB check constraint, the RolesGuard hierarchy, invitation DTOs and route
 * decorators — including a phantom `owner` role that the DB never allowed. Everything role-related
 * should reference these constants.
 */

/** Canonical role set — must stay in sync with the users/org_invitations `*_role_check` constraints. */
export const USER_ROLES = [
  'user',
  'manager',
  'admin',
  'sysadmin',
  'platform_admin',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Privilege weights for the RolesGuard. `@Roles(...)` grants access when the caller's weight is
 * >= the lowest required role's weight, so higher roles inherit lower-role permissions.
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  platform_admin: 100,
  sysadmin: 50,
  admin: 50,
  manager: 30,
  user: 10,
};

/**
 * Roles that may be granted through an org invitation. Never `platform_admin` (privilege
 * escalation) and never `user` (has no org permissions).
 */
export const INVITABLE_ROLES = ['manager', 'admin', 'sysadmin'] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
