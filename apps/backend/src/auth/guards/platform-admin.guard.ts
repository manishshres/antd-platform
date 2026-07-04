import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    return request.user?.role === 'platform_admin';
  }
}
