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
import { eq, count } from 'drizzle-orm';
import { notDeleted } from '../database/db.utils';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateUserDto, UpdateUserGlobalDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditService } from '../common/services/audit.service';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly auditService: AuditService,
  ) {}

  async findOneByEmail(email: string) {
    const results = await this.db
      .select()
      .from(schema.users)
      .where(notDeleted(schema.users, eq(schema.users.email, email)))
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
        email,
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
        email: dto.email,
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
        ...(dto.email !== undefined ? { email: dto.email } : {}),
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

    void this.auditService.log({
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

    void this.auditService.log({
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
        ...(dto.email !== undefined ? { email: dto.email } : {}),
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

    void this.auditService.log({
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

    void this.auditService.log({
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

    void this.auditService.log({
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
        ...(dto.email !== undefined ? { email: dto.email } : {}),
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
    };
  }
}
