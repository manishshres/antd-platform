import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Application-wide JWT guard (registered as APP_GUARD).
 *
 * Enforces authentication on every route by default so a forgotten `@UseGuards(JwtAuthGuard)`
 * can no longer ship an open endpoint (H6). Routes opt out with `@Public()`. A small path
 * allow-list covers infra endpoints mounted by libraries we can't decorate (Prometheus
 * `/metrics`), which are meant to be scrape-able without a bearer token.
 */
@Injectable()
export class GlobalJwtAuthGuard extends JwtAuthGuard {
  private static readonly ALLOWLISTED_SUFFIXES = ['/metrics'];

  constructor(reflector: Reflector) {
    super(reflector);
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const path = (req.path || req.url || '').split('?')[0];
    if (
      GlobalJwtAuthGuard.ALLOWLISTED_SUFFIXES.some((suffix) =>
        path.endsWith(suffix),
      )
    ) {
      return true;
    }
    return super.canActivate(context);
  }
}
