import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export class CurrentUserPayload {
  id!: string;
  email!: string;
  role!: string;
  organizationId!: string | null;
  locationId!: string | null;
  isPlatformAdmin!: boolean;
}

/**
 * @CurrentUser() — extracts the authenticated user from the JWT-populated request.
 *
 * Usage:
 *   async myMethod(@CurrentUser() user: CurrentUserPayload) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: CurrentUserPayload }>();
    return request.user;
  },
);
