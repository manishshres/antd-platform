import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { MailService } from '../common/services/mail.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../common/services/audit.service';
import { AuthService } from '../auth/auth.service';
import { randomBytes, createHash } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
  ) {}

  async createInvitation(
    organizationId: string,
    inviterId: string,
    dto: CreateInvitationDto,
  ) {
    if (dto.role !== 'sysadmin' && dto.role !== 'manager') {
      throw new BadRequestException('Role must be sysadmin or manager');
    }

    const existingUser = await this.usersService.findOneByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists.');
    }

    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [result] = await this.db
      .insert(schema.orgInvitations)
      .values({
        organizationId,
        locationId: dto.locationId,
        email: dto.email,
        role: dto.role,
        tokenHash,
        status: 'pending',
        expiresAt,
        invitedByUserId: inviterId,
      })
      .returning();

    const [org] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    await this.mailService.sendOrganizationInvitation(
      dto.email,
      rawToken,
      org.name,
    );

    void this.auditService.log({
      action: 'org.invitation.sent',
      organizationId,
      userId: inviterId,
      entityId: result.id,
      entityType: 'org_invitations',
      newValue: { email: dto.email, role: dto.role },
    });

    return { message: 'Invitation sent.' };
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const tokenHash = hashToken(dto.token);

    const [invitation] = await this.db
      .select()
      .from(schema.orgInvitations)
      .where(eq(schema.orgInvitations.tokenHash, tokenHash))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException('Invalid invitation token.');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is no longer valid.');
    }
    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('Invitation has expired.');
    }

    const passwordHash = await this.authService.hashPassword(dto.password);

    const user = await this.usersService.create(
      invitation.email,
      passwordHash,
      invitation.role,
      invitation.organizationId,
      dto.firstName,
      dto.lastName,
      dto.phoneNumber,
    );

    // Verify email automatically since they accepted via email link
    // Also assign locationId if present in the invitation
    await this.db
      .update(schema.users)
      .set({
        emailVerifiedAt: new Date(),
        locationId: invitation.locationId || null,
      })
      .where(eq(schema.users.id, user.id));

    await this.db
      .update(schema.orgInvitations)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(schema.orgInvitations.id, invitation.id));

    await this.auditService.log({
      action: 'invitation.accept',
      userId: user.id,
      organizationId: invitation.organizationId,
      entityId: invitation.id,
    });

    const tokens = await this.authService.login({
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      emailVerifiedAt: user.emailVerifiedAt,
    });

    return { message: 'Invitation accepted successfully.', ...tokens };
  }

  async listInvitations(organizationId: string) {
    return this.db
      .select({
        id: schema.orgInvitations.id,
        email: schema.orgInvitations.email,
        role: schema.orgInvitations.role,
        status: schema.orgInvitations.status,
        expiresAt: schema.orgInvitations.expiresAt,
        createdAt: schema.orgInvitations.createdAt,
      })
      .from(schema.orgInvitations)
      .where(eq(schema.orgInvitations.organizationId, organizationId));
  }

  async revokeInvitation(organizationId: string, invitationId: string) {
    const [invitation] = await this.db
      .select()
      .from(schema.orgInvitations)
      .where(
        and(
          eq(schema.orgInvitations.id, invitationId),
          eq(schema.orgInvitations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Can only revoke pending invitations.');
    }

    await this.db
      .update(schema.orgInvitations)
      .set({ status: 'revoked' })
      .where(eq(schema.orgInvitations.id, invitationId));

    void this.auditService.log({
      action: 'org.invitation.revoked',
      organizationId,
      entityId: invitationId,
      entityType: 'org_invitations',
    });

    return { message: 'Invitation revoked.' };
  }

  async validateToken(token: string) {
    const tokenHash = hashToken(token);

    const [invitation] = await this.db
      .select({
        id: schema.orgInvitations.id,
        email: schema.orgInvitations.email,
        role: schema.orgInvitations.role,
        organizationId: schema.orgInvitations.organizationId,
        orgName: schema.organizations.name,
        locationName: schema.locations.name,
      })
      .from(schema.orgInvitations)
      .innerJoin(
        schema.organizations,
        eq(schema.orgInvitations.organizationId, schema.organizations.id),
      )
      .leftJoin(
        schema.locations,
        eq(schema.orgInvitations.locationId, schema.locations.id),
      )
      .where(
        and(
          eq(schema.orgInvitations.tokenHash, tokenHash),
          eq(schema.orgInvitations.status, 'pending'),
        ),
      )
      .limit(1);

    if (!invitation) {
      throw new NotFoundException('Invalid or expired invitation token.');
    }

    return {
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.orgName,
      locationName: invitation.locationName,
    };
  }

  async resendInvitation(organizationId: string, invitationId: string) {
    const [invitation] = await this.db
      .select()
      .from(schema.orgInvitations)
      .where(
        and(
          eq(schema.orgInvitations.id, invitationId),
          eq(schema.orgInvitations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Can only resend pending invitations.');
    }

    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db
      .update(schema.orgInvitations)
      .set({
        tokenHash,
        expiresAt,
      })
      .where(eq(schema.orgInvitations.id, invitation.id));

    const [org] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    await this.mailService.sendOrganizationInvitation(
      invitation.email,
      rawToken,
      org?.name || 'an organization',
    );

    void this.auditService.log({
      action: 'org.invitation.sent',
      organizationId,
      entityId: invitationId,
      entityType: 'org_invitations',
      newValue: {
        email: invitation.email,
        role: invitation.role,
        isResend: true,
      },
    });

    return { message: 'Invitation resent.' };
  }
}
