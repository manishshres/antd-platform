import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalJwtAuthGuard } from './global-jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

function ctxForPath(path: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ path, url: path }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('GlobalJwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: GlobalJwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new GlobalJwtAuthGuard(reflector);
  });

  it('allows the Prometheus /metrics path without a token', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    // Should short-circuit before consulting @Public metadata or passport.
    expect(guard.canActivate(ctxForPath('/api/metrics'))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('bypasses auth for @Public() routes', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => key === IS_PUBLIC_KEY);
    expect(guard.canActivate(ctxForPath('/api/v1/auth/login'))).toBe(true);
  });

  it('does not short-circuit a protected route to true (delegates to passport)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    // A non-public, non-allowlisted route must fall through to passport rather than being
    // waved through. We assert it is NOT the synchronous `true` returned by the fast paths.
    const superSpy = jest
      .spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
          canActivate: () => unknown;
        },
        'canActivate',
      )
      .mockReturnValue('delegated');
    const result = guard.canActivate(ctxForPath('/api/v1/orders')) as unknown;
    expect(result).toBe('delegated');
    expect(superSpy).toHaveBeenCalled();
  });
});
