import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { UsersService } from '../../users/users.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // JWT_SECRET presence is guaranteed by validateEnv at bootstrap — no insecure fallback.
      secretOrKey: configService.get<string>('JWT_SECRET') as string,
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request & { query?: Record<string, unknown> },
    payload: { sub: string; email: string; role: string },
  ) {
    const user = await this.usersService.findOneById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or session invalid.');
    }

    let orgId = user.organizationId;
    const isPlatformAdmin = user.role === 'platform_admin';

    // Platform admins may act within a specific tenant by passing ?orgId=<uuid>. Only accept
    // it from the query string, and only when it is a well-formed UUID — this is impersonation,
    // so an invalid or body-smuggled value must never silently change tenant context (H9).
    if (isPlatformAdmin) {
      const override = req?.query?.orgId;
      if (typeof override === 'string' && UUID_RE.test(override)) {
        if (override !== user.organizationId) {
          this.logger.log(
            `Platform admin ${user.email} operating in tenant context ${override}.`,
          );
        }
        orgId = override;
      }
    }

    // Return user info to be attached to req.user
    return {
      id: user.id,
      email: user.email,
      role: isPlatformAdmin ? 'platform_admin' : user.role,
      organizationId: orgId,
      locationId: user.locationId ?? null,
      isPlatformAdmin,
    };
  }
}
