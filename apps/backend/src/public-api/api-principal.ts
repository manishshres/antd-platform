import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

/**
 * Synthetic principal for API-key-authenticated requests. The public API is
 * authenticated per organization (not per user), so downstream services that
 * resolve tenancy via BillingService.getRequiredOrg() get the org straight
 * from this payload. The 'api' role is intentionally not 'user' so org-level
 * integrations (e.g. a POS terminal) can apply manager-gated discounts.
 */
export function apiPrincipal(organizationId: string): CurrentUserPayload {
  return {
    id: 'public-api',
    email: 'public-api@internal',
    role: 'api',
    organizationId,
    locationId: null,
    isPlatformAdmin: false,
  };
}
