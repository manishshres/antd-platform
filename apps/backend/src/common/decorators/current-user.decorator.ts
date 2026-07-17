import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * `CurrentUserPayload` is the JS-side shape returned by `JwtStrategy.validate(req, payload)`
 * and exposed via the `@CurrentUser()` parameter decorator. We declare it as a
 * **class** (not an interface) on purpose because the
 * `isolatedModules + emitDecoratorMetadata` combo in `tsconfig.json` requires a
 * runtime-erased type for parameter decorators — interfaces don't qualify
 * (TS1272 in every controller on `import { CurrentUserPayload }`).
 *
 * Trade-off: unit specs that want to pass a partial `CurrentUserPayload` use
 * `as CurrentUserPayload` casts at the call site. AGENTS.md §3 explicitly
 * documents this contract.
 */
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
