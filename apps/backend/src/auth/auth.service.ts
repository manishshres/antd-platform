import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { MailService } from '../common/services/mail.service';
import { AuditService } from '../common/services/audit.service';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const REFRESH_TTL_DEFAULT = 24 * 60 * 60; // 24 hours
export const REFRESH_TTL_REMEMBER_ME = 30 * 24 * 60 * 60; // 30 days in seconds

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<{
    id: string;
    email: string;
    role: string;
    organizationId: string | null;
    emailVerifiedAt: Date | null;
  } | null> {
    const user = await this.usersService.findOneByEmail(email);
    if (!user) return null;

    // Check account lockout
    if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
      throw new HttpException(
        'Account temporarily locked due to too many failed attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordValid = await bcrypt.compare(pass, user.passwordHash);

    if (!passwordValid) {
      const maxAttempts = this.configService.get<number>(
        'ACCOUNT_MAX_FAILED_ATTEMPTS',
        5,
      );
      const lockoutDuration = this.configService.get<number>(
        'ACCOUNT_LOCKOUT_DURATION_MS',
        60000,
      );

      // M3: Atomic increment — eliminates the read-modify-write race on concurrent requests.
      // We increment in SQL and then re-fetch to decide whether to lock.
      const [updated] = await this.db
        .update(schema.users)
        .set({
          failedLoginAttempts: sql<number>`${schema.users.failedLoginAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id))
        .returning({ attempts: schema.users.failedLoginAttempts });

      const newAttempts = updated?.attempts ?? 1;
      const isNowLocked = newAttempts >= maxAttempts;

      if (isNowLocked) {
        await this.db
          .update(schema.users)
          .set({
            lockedUntil: new Date(Date.now() + lockoutDuration),
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, user.id));
        this.logger.warn(
          `Account ${email} locked after ${newAttempts} failed attempts.`,
        );
      }
      return null;
    }

    // Successful login — reset lockout counters
    await this.db
      .update(schema.users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id));

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
    };
  }

  async login(
    user: {
      id: string;
      email: string;
      role: string;
      organizationId?: string | null;
      emailVerifiedAt?: Date | null;
    },
    rememberMe = false,
  ) {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      organizationId: user.organizationId ?? null,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshTtlSecs = rememberMe
      ? REFRESH_TTL_REMEMBER_ME
      : REFRESH_TTL_DEFAULT;
    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtlSecs,
      },
    );

    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + refreshTtlSecs);

    await this.db.insert(schema.refreshTokens).values({
      token: tokenHash,
      userId: user.id,
      // M2: Persist the chosen TTL so refresh() can reuse it across rotations.
      ttlSecs: refreshTtlSecs,
      expiresAt,
    });

    this.logger.log(
      `User ${user.email} logged in (rememberMe: ${rememberMe}).`,
    );

    this.auditService.fireAndForget({
      action: 'auth.login',
      userId: user.id,
      organizationId: user.organizationId,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId ?? null,
        emailVerified: !!user.emailVerifiedAt,
      },
    };
  }

  async refresh(token: string) {
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const tokenHash = hashToken(token);

      const results = await this.db
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.token, tokenHash))
        .limit(1);

      const storedToken = results[0];

      // Reuse detection (H2): the signature is valid but this hash is not in the DB. That means
      // the token was already rotated away (used) — a replay of a stolen, superseded token. Treat
      // the whole family as compromised and revoke every refresh token for this user.
      if (!storedToken) {
        await this.db
          .delete(schema.refreshTokens)
          .where(eq(schema.refreshTokens.userId, payload.sub));
        this.logger.warn(
          `Refresh token reuse detected for user ${payload.sub}; all sessions revoked.`,
        );
        this.auditService.fireAndForget({
          action: 'auth.refresh_token_reuse',
          userId: payload.sub,
        });
        throw new UnauthorizedException('Refresh token is invalid or expired.');
      }

      if (new Date() > new Date(storedToken.expiresAt)) {
        // Expired but legitimately stored — remove it and require re-login.
        await this.db
          .delete(schema.refreshTokens)
          .where(eq(schema.refreshTokens.token, tokenHash));
        throw new UnauthorizedException('Refresh token is invalid or expired.');
      }

      const user = await this.usersService.findOneById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found.');
      }

      // Token rotation: delete old, issue new
      await this.db
        .delete(schema.refreshTokens)
        .where(eq(schema.refreshTokens.token, tokenHash));

      const newPayload = {
        email: user.email,
        sub: user.id,
        role: user.role,
        organizationId: user.organizationId ?? null,
      };
      const newAccessToken = this.jwtService.sign(newPayload);

      // M2: Reuse the TTL from the original token family so rememberMe sessions stay long.
      const refreshTtlSecs =
        storedToken.ttlSecs ??
        this.configService.get<number>(
          'JWT_REFRESH_EXPIRATION',
          REFRESH_TTL_DEFAULT,
        );
      const newRefreshToken = this.jwtService.sign(
        { sub: user.id },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshTtlSecs,
        },
      );
      const newTokenHash = hashToken(newRefreshToken);
      const newExpiresAt = new Date();
      newExpiresAt.setSeconds(newExpiresAt.getSeconds() + refreshTtlSecs);

      await this.db.insert(schema.refreshTokens).values({
        token: newTokenHash,
        userId: user.id,
        ttlSecs: refreshTtlSecs,
        expiresAt: newExpiresAt,
      });

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        refreshTtlSecs,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Token validation failed';
      this.logger.warn(`Refresh token validation failed: ${message}`);
      throw new UnauthorizedException('Invalid refresh token.');
    }
  }

  async logout(token: string) {
    const tokenHash = hashToken(token);
    await this.db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.token, tokenHash));
    this.logger.log('Refresh token revoked.');
    return { success: true };
  }

  // ─── Forgot / Reset Password ─────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findOneByEmail(email);
    // Always return success to avoid leaking whether the email exists
    if (!user || user.deletedAt) return;

    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    // Invalidate any existing unused reset tokens for this user
    await this.db
      .delete(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, user.id),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      );

    await this.db.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    await this.mailService.sendPasswordReset(email, rawToken);
    this.logger.log(`Password reset token issued for ${email}.`);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    const [record] = await this.db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record) {
      throw new BadRequestException('Reset token is invalid.');
    }
    if (record.usedAt) {
      throw new BadRequestException('Reset token has already been used.');
    }
    if (new Date() > record.expiresAt) {
      throw new BadRequestException('Reset token has expired.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.db
      .update(schema.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.users.id, record.userId));

    // Mark token as used
    await this.db
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.passwordResetTokens.id, record.id));

    // Revoke all existing refresh tokens for security
    await this.db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, record.userId));

    this.logger.log(`Password reset successfully for user ${record.userId}.`);

    this.auditService.fireAndForget({
      action: 'auth.password_reset',
      userId: record.userId,
    });
  }

  // ─── Email Verification ──────────────────────────────────────────────────

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    // Delete any previous unverified tokens for this user
    await this.db
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, userId));

    await this.db.insert(schema.emailVerificationTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });

    await this.mailService.sendEmailVerification(email, rawToken);
    this.logger.log(`Email verification token issued for ${email}.`);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    const [record] = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record) {
      throw new BadRequestException('Verification token is invalid.');
    }
    if (new Date() > record.expiresAt) {
      throw new BadRequestException(
        'Verification token has expired. Request a new one.',
      );
    }

    await this.db
      .update(schema.users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, record.userId));

    // Delete the used token
    await this.db
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.id, record.id));

    this.logger.log(`Email verified for user ${record.userId}.`);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findOneById(userId);
    if (!user) throw new BadRequestException('User not found.');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified.');
    }
    await this.sendVerificationEmail(userId, user.email);
  }
}
