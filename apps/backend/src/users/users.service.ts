import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import {
  eq,
  count,
  and,
  isNotNull,
  isNull,
  inArray,
  desc,
  sql,
} from 'drizzle-orm';
import { notDeleted } from '../database/db.utils';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateUserDto, UpdateUserGlobalDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditService } from '../common/services/audit.service';

/** Roles allowed to hold a POS manager PIN. */
const POS_PIN_ROLES = [
  'manager',
  'admin',
  'sysadmin',
  'platform_admin',
] as const;

/** Failed PIN entries before the PIN locks (N3). A 4-digit PIN is only 10k guesses. */
const POS_PIN_MAX_ATTEMPTS = 5;
const POS_PIN_LOCKOUT_MINUTES = 15;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly auditService: AuditService,
  ) {}

  /** Emails are matched and stored case-insensitively (RFC 5321 local-part
   * case is technically significant, but no real mail provider enforces
   * that, and users routinely type their own address inconsistently). */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async findOneByEmail(email: string) {
    const results = await this.db
      .select()
      .from(schema.users)
      .where(
        notDeleted(
          schema.users,
          eq(sql`lower(${schema.users.email})`, this.normalizeEmail(email)),
        ),
      )
      .limit(1);
    return results[0] || null;
  }

  async findOneById(id: string) {
    const results = await this.db
      .select()
      .from(schema.users)
      .where(notDeleted(schema.users, eq(schema.users.id, id)))
      .limit(1);
    return results[0] || null;
  }

  async create(
    email: string,
    passwordHash: string,
    role: string = 'user',
    organizationId?: string,
    firstName?: string,
    lastName?: string,
    phoneNumber?: string,
    companyName?: string,
  ) {
    const results = await this.db
      .insert(schema.users)
      .values({
        email: this.normalizeEmail(email),
        passwordHash,
        role,
        organizationId,
        firstName,
        lastName,
        phoneNumber,
        companyName,
      })
      .returning();
    return results[0];
  }

  async createTeamMember(organizationId: string, dto: CreateTeamMemberDto) {
    const existing = await this.findOneByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email address is already in use.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.create(
      dto.email,
      passwordHash,
      dto.role,
      organizationId,
      dto.firstName,
      dto.lastName,
      dto.phoneNumber,
      dto.companyName,
    );

    return this.sanitizeUser(user);
  }

  async listAllUsersGlobal(
    pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { offset = 0, limit = 20 } = pagination;

    const data = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        phoneNumber: schema.users.phoneNumber,
        companyName: schema.users.companyName,
        emailVerifiedAt: schema.users.emailVerifiedAt,
        lastLoginAt: schema.users.lastLoginAt,
        organizationId: schema.users.organizationId,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
        organization: {
          id: schema.organizations.id,
          name: schema.organizations.name,
        },
      })
      .from(schema.users)
      .leftJoin(
        schema.organizations,
        eq(schema.users.organizationId, schema.organizations.id),
      )
      .where(notDeleted(schema.users))
      .orderBy(schema.users.createdAt)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.users)
      .where(notDeleted(schema.users));

    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }

  async createUserGlobal(dto: CreateUserDto) {
    const existing = await this.findOneByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email address is already in use.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const [newUser] = await this.db
      .insert(schema.users)
      .values({
        email: this.normalizeEmail(dto.email),
        passwordHash,
        role: dto.role,
        organizationId: dto.organizationId,
        firstName: dto.firstName || null,
        lastName: dto.lastName || null,
        phoneNumber: dto.phoneNumber || null,
        companyName: dto.companyName || null,
      })
      .returning();

    return this.sanitizeUser(newUser);
  }

  async getUserGlobal(id: string) {
    const user = await this.findOneById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found.`);
    }
    return this.sanitizeUser(user);
  }

  async updateUserGlobal(id: string, dto: UpdateUserGlobalDto) {
    const user = await this.findOneById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found.`);
    }

    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const existing = await this.findOneByEmail(dto.email);
      if (existing) {
        throw new ConflictException('Email address is already in use.');
      }
    }

    let passwordHash = undefined;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, 12);
    }

    const [updated] = await this.db
      .update(schema.users)
      .set({
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.email !== undefined
          ? { email: this.normalizeEmail(dto.email) }
          : {}),
        ...(dto.phoneNumber !== undefined
          ? { phoneNumber: dto.phoneNumber }
          : {}),
        ...(dto.companyName !== undefined
          ? { companyName: dto.companyName }
          : {}),
        ...(dto.organizationId !== undefined
          ? { organizationId: dto.organizationId }
          : {}),
        ...(passwordHash ? { passwordHash } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .returning();

    this.auditService.fireAndForget({
      action: 'user.update',
      userId: updated.id,
      organizationId: updated.organizationId,
      entityType: 'user',
      entityId: updated.id,
      newValue: { role: updated.role, email: updated.email },
    });

    return this.sanitizeUser(updated);
  }

  async deleteUserGlobal(id: string) {
    const user = await this.findOneById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found.`);
    }

    await this.db
      .update(schema.users)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id));

    this.auditService.fireAndForget({
      action: 'user.delete',
      userId: user.id,
      organizationId: user.organizationId,
      entityType: 'user',
      entityId: user.id,
    });

    return { success: true };
  }

  // ─── Organization Users Management (Admin/Owner scope) ──────────────────────

  async listUsers(
    organizationId: string,
    pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { offset = 0, limit = 20 } = pagination;

    const data = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        phoneNumber: schema.users.phoneNumber,
        companyName: schema.users.companyName,
        emailVerifiedAt: schema.users.emailVerifiedAt,
        lastLoginAt: schema.users.lastLoginAt,
        organizationId: schema.users.organizationId,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(
        notDeleted(
          schema.users,
          eq(schema.users.organizationId, organizationId),
        ),
      )
      .orderBy(schema.users.createdAt)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.users)
      .where(
        notDeleted(
          schema.users,
          eq(schema.users.organizationId, organizationId),
        ),
      );

    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }

  async getUserById(id: string, organizationId: string) {
    const user = await this.verifyUserOrgOwnership(id, organizationId);
    return this.sanitizeUser(user);
  }

  async updateUser(id: string, organizationId: string, dto: UpdateUserDto) {
    const user = await this.verifyUserOrgOwnership(id, organizationId);

    // If updating email, check uniqueness
    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const existing = await this.findOneByEmail(dto.email);
      if (existing) {
        throw new ConflictException(
          'Email address is already in use by another user.',
        );
      }
    }

    const [updated] = await this.db
      .update(schema.users)
      .set({
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.email !== undefined
          ? { email: this.normalizeEmail(dto.email) }
          : {}),
        ...(dto.phoneNumber !== undefined
          ? { phoneNumber: dto.phoneNumber }
          : {}),
        ...(dto.companyName !== undefined
          ? { companyName: dto.companyName }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .returning();

    return this.sanitizeUser(updated);
  }

  async deleteUser(id: string, organizationId: string) {
    await this.verifyUserOrgOwnership(id, organizationId);

    await this.db
      .update(schema.users)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id));

    // Force log out immediately upon deletion
    await this.forceLogout(id, organizationId);

    this.auditService.fireAndForget({
      action: 'user.delete',
      userId: id,
      organizationId: organizationId,
      entityType: 'user',
      entityId: id,
    });

    return { success: true };
  }

  async forceLogout(id: string, organizationId: string) {
    await this.verifyUserOrgOwnership(id, organizationId);

    await this.db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, id));

    this.auditService.fireAndForget({
      action: 'user.force_logout',
      userId: id,
      organizationId: organizationId,
      entityType: 'user',
      entityId: id,
    });

    return { success: true };
  }

  async forceLogoutGlobal(id: string) {
    const user = await this.findOneById(id);
    if (!user) throw new NotFoundException(`User ${id} not found.`);

    await this.db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, id));

    this.auditService.fireAndForget({
      action: 'user.force_logout',
      userId: id,
      organizationId: user.organizationId,
      entityType: 'user',
      entityId: id,
    });

    return { success: true };
  }

  // ─── Self Profile Management ─────────────────────────────────────────────

  async getMe(userId: string) {
    const user = await this.findOneById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return this.sanitizeUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.findOneById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const existing = await this.findOneByEmail(dto.email);
      if (existing) {
        throw new ConflictException('Email address is already in use.');
      }
    }

    const [updated] = await this.db
      .update(schema.users)
      .set({
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.email !== undefined
          ? { email: this.normalizeEmail(dto.email) }
          : {}),
        ...(dto.phoneNumber !== undefined
          ? { phoneNumber: dto.phoneNumber }
          : {}),
        ...(dto.companyName !== undefined
          ? { companyName: dto.companyName }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    return this.sanitizeUser(updated);
  }

  /**
   * Mark the first-run onboarding tour as completed for this user. Persisted in the DB (rather
   * than only browser localStorage) so the tour doesn't re-appear on a different device/browser.
   * Idempotent — safe to call more than once; the first completion timestamp is preserved.
   */
  async completeOnboarding(userId: string) {
    const user = await this.findOneById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (!user.onboardingCompletedAt) {
      await this.db
        .update(schema.users)
        .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }
    return { message: 'Onboarding completed.' };
  }

  async changeMyPassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.db.query.users.findFirst({
      where: notDeleted(schema.users, eq(schema.users.id, userId)),
    });
    if (!user) throw new NotFoundException('User not found.');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid)
      throw new UnauthorizedException('Current password is incorrect.');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.db
      .update(schema.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));

    return { message: 'Password updated successfully.' };
  }

  async deleteMe(userId: string) {
    const user = await this.findOneById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    await this.db
      .update(schema.users)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    return { success: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async verifyUserOrgOwnership(id: string, organizationId: string) {
    const user = await this.findOneById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found.`);
    }
    if (user.organizationId !== organizationId) {
      throw new ForbiddenException('You do not have access to this user.');
    }
    return user;
  }

  private sanitizeUser(user: typeof schema.users.$inferSelect) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      companyName: user.companyName,
      emailVerifiedAt: user.emailVerifiedAt,
      onboardingCompletedAt: user.onboardingCompletedAt,
      lastLoginAt: user.lastLoginAt,
      organizationId: user.organizationId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      posPinSet: !!user.posPinHash,
    };
  }

  /**
   * Set a user's POS PIN.
   *
   * PINs must be unique within an organization (N3). `verifyManagerPin` may be called
   * without a candidate id (a manager approving another employee's action), and in that
   * mode it resolves the PIN to whichever manager matches first — with duplicate PINs the
   * audit trail would name the wrong person. Rejecting duplicates at set time is the only
   * point where that is cheap to enforce.
   */
  async setPosPin(userId: string, pin: string): Promise<void> {
    const [target] = await this.db
      .select({ organizationId: schema.users.organizationId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!target) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (target.organizationId) {
      const peers = await this.db
        .select({ id: schema.users.id, posPinHash: schema.users.posPinHash })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.organizationId, target.organizationId),
            isNotNull(schema.users.posPinHash),
            notDeleted(schema.users),
          ),
        );

      for (const peer of peers) {
        if (peer.id === userId || !peer.posPinHash) continue;
        if (await bcrypt.compare(pin, peer.posPinHash)) {
          throw new ConflictException(
            'That PIN is already in use by another employee. Choose a different one.',
          );
        }
      }
    }

    const posPinHash = await bcrypt.hash(pin, 12);
    await this.db
      .update(schema.users)
      .set({
        posPinHash,
        // A fresh PIN clears any standing lockout.
        posPinFailedAttempts: 0,
        posPinLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));
  }

  /**
   * Verify a POS manager PIN (N3).
   *
   * Two modes:
   * - `actingUserId` given — check only that user's PIN. Failures are counted against that
   *   user and lock the PIN after {@link POS_PIN_MAX_ATTEMPTS} tries.
   * - omitted — a manager approving another employee's action. Every manager in the org is
   *   compared, so failures cannot be attributed to one user; the caller-side rate limit
   *   (`ApiKeyThrottlerGuard` on the PIN routes) is what bounds guessing here. PIN
   *   uniqueness is enforced in {@link setPosPin} so a match names exactly one manager.
   *
   * Every failure is audit-logged. Returns null on any rejection — callers must not
   * distinguish "no such user" from "wrong PIN" in their response.
   */
  async verifyManagerPin(
    organizationId: string,
    pin: string,
    actingUserId?: string,
  ): Promise<typeof schema.users.$inferSelect | null> {
    if (actingUserId) {
      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.id, actingUserId),
            eq(schema.users.organizationId, organizationId),
            isNotNull(schema.users.posPinHash),
            inArray(schema.users.role, [...POS_PIN_ROLES]),
            notDeleted(schema.users),
          ),
        );
      if (!user?.posPinHash) {
        await this.recordPinFailure(
          organizationId,
          actingUserId,
          'unknown_user',
        );
        return null;
      }

      if (user.posPinLockedUntil && user.posPinLockedUntil > new Date()) {
        await this.recordPinFailure(organizationId, user.id, 'locked_out');
        return null;
      }

      if (await bcrypt.compare(pin, user.posPinHash)) {
        // Successful entry clears the counter.
        if (user.posPinFailedAttempts > 0 || user.posPinLockedUntil) {
          await this.db
            .update(schema.users)
            .set({ posPinFailedAttempts: 0, posPinLockedUntil: null })
            .where(eq(schema.users.id, user.id));
        }
        return user;
      }

      await this.registerFailedPinAttempt(user.id);
      await this.recordPinFailure(organizationId, user.id, 'wrong_pin');
      return null;
    }

    const managers = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.organizationId, organizationId),
          isNotNull(schema.users.posPinHash),
          inArray(schema.users.role, [...POS_PIN_ROLES]),
          notDeleted(schema.users),
        ),
      );

    const now = new Date();
    for (const manager of managers) {
      if (!manager.posPinHash) continue;
      // A locked-out manager's PIN is inert in this mode too, otherwise the lockout
      // would be trivially bypassed by dropping candidateEmployeeId from the request.
      if (manager.posPinLockedUntil && manager.posPinLockedUntil > now)
        continue;
      if (await bcrypt.compare(pin, manager.posPinHash)) {
        if (manager.posPinFailedAttempts > 0) {
          await this.db
            .update(schema.users)
            .set({ posPinFailedAttempts: 0, posPinLockedUntil: null })
            .where(eq(schema.users.id, manager.id));
        }
        return manager;
      }
    }

    await this.recordPinFailure(
      organizationId,
      undefined,
      'wrong_pin_org_wide',
    );
    return null;
  }

  /** Atomic increment + lockout once the attempt ceiling is reached (mirrors the M3 fix). */
  private async registerFailedPinAttempt(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        posPinFailedAttempts: sql`${schema.users.posPinFailedAttempts} + 1`,
        posPinLockedUntil: sql`CASE WHEN ${schema.users.posPinFailedAttempts} + 1 >= ${POS_PIN_MAX_ATTEMPTS}
          THEN now() + interval '${sql.raw(String(POS_PIN_LOCKOUT_MINUTES))} minutes'
          ELSE ${schema.users.posPinLockedUntil} END`,
      })
      .where(eq(schema.users.id, userId));
  }

  private async recordPinFailure(
    organizationId: string,
    userId: string | undefined,
    reason: string,
  ): Promise<void> {
    await this.auditService.log({
      organizationId,
      userId,
      action: 'pos.pin.verify_failed',
      entityType: 'user',
      entityId: userId ?? 'unknown',
      newValue: { reason },
    });
  }

  /** The user's currently open shift, if any (clock_out_at is still null). */
  async getOpenClockEntry(organizationId: string, userId: string) {
    const [entry] = await this.db
      .select()
      .from(schema.timeClockEntries)
      .where(
        and(
          eq(schema.timeClockEntries.organizationId, organizationId),
          eq(schema.timeClockEntries.userId, userId),
          isNull(schema.timeClockEntries.clockOutAt),
        ),
      )
      .orderBy(desc(schema.timeClockEntries.clockInAt))
      .limit(1);
    return entry ?? null;
  }

  async clockIn(organizationId: string, userId: string, locationId?: string) {
    const open = await this.getOpenClockEntry(organizationId, userId);
    if (open) return open;
    const [entry] = await this.db
      .insert(schema.timeClockEntries)
      .values({ organizationId, userId, locationId: locationId ?? null })
      .returning();
    return entry;
  }

  async clockOut(organizationId: string, userId: string) {
    const open = await this.getOpenClockEntry(organizationId, userId);
    if (!open) {
      throw new ConflictException('No open shift to clock out of.');
    }
    const [entry] = await this.db
      .update(schema.timeClockEntries)
      .set({ clockOutAt: new Date() })
      .where(eq(schema.timeClockEntries.id, open.id))
      .returning();
    return entry;
  }
}
