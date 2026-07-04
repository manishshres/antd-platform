import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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
    req: any,
    payload: { sub: string; email: string; role: string },
  ) {
    const user = await this.usersService.findOneById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or session invalid.');
    }

    let orgId = user.organizationId;
    const isPlatformAdmin = user.role === 'platform_admin';

    if (isPlatformAdmin) {
      if (
        req?.query?.orgId &&
        req.query.orgId !== 'undefined' &&
        req.query.orgId !== 'null'
      ) {
        orgId = req.query.orgId;
      } else if (
        req?.body?.orgId &&
        req.body.orgId !== 'undefined' &&
        req.body.orgId !== 'null'
      ) {
        orgId = req.body.orgId;
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
