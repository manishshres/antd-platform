import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, sql, getTableColumns } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AuditService } from '../common/services/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { notDeleted } from '../database/db.utils';
import { generateUniqueSlug } from '../common/utils/slug.util';

@Injectable()
export class LocationsService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly telnyxService: TelnyxService,
    private readonly auditService: AuditService,
    private readonly invitationsService: InvitationsService,
  ) {}

  async listLocations(organizationId: string) {
    return (
      this.db
        // Every location column plus the owning organization's name. The POS prints the
        // business name at the top of a receipt, and a location name alone ("Manayunk") is
        // not what a customer needs to see on it.
        .select({
          ...getTableColumns(schema.locations),
          organizationName: schema.organizations.name,
        })
        .from(schema.locations)
        .innerJoin(
          schema.organizations,
          eq(schema.locations.organizationId, schema.organizations.id),
        )
        .where(
          notDeleted(
            schema.locations,
            eq(schema.locations.organizationId, organizationId),
          ),
        )
        .orderBy(schema.locations.createdAt)
    );
  }

  async createLocation(organizationId: string, dto: CreateLocationDto) {
    const slug = generateUniqueSlug(dto.name);
    const [location] = await this.db
      .insert(schema.locations)
      .values({
        organizationId,
        slug,
        ...dto,
      })
      .returning();

    this.auditService.fireAndForget({
      action: 'location.created',
      organizationId,
      entityId: location.id,
      entityType: 'locations',
      newValue: { ...location },
    });

    return location;
  }

  async updateLocation(
    organizationId: string,
    locationId: string,
    dto: UpdateLocationDto,
  ) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(
        notDeleted(
          schema.locations,
          and(
            eq(schema.locations.id, locationId),
            eq(schema.locations.organizationId, organizationId),
          ),
        ),
      )
      .limit(1);

    if (!location) {
      throw new NotFoundException('Location not found in your organization.');
    }

    const updatePayload: Record<string, any> = {
      ...dto,
      updatedAt: new Date(),
    };

    // Auto-activate location if phone number or AI agent is added manually and no status specified
    if (!dto.status && (dto.phoneNumber || dto.telnyxAssistantId)) {
      if (location.status === 'draft' || location.status === 'provisioning') {
        updatePayload.status = 'active';
      }
    }

    const [updated] = await this.db
      .update(schema.locations)
      .set(updatePayload)
      .where(eq(schema.locations.id, locationId))
      .returning();

    // Map phone number to orgPhoneNumbers table for routing & plan limit tracking
    if (dto.phoneNumber) {
      const existingMapping = await this.db
        .select()
        .from(schema.orgPhoneNumbers)
        .where(eq(schema.orgPhoneNumbers.phoneNumber, dto.phoneNumber))
        .limit(1);

      if (existingMapping.length === 0) {
        await this.db.insert(schema.orgPhoneNumbers).values({
          organizationId,
          locationId,
          phoneNumber: dto.phoneNumber,
          externalId: dto.telnyxPhoneNumberId || null,
          name: `${updated.name} Phone`,
        });
      } else {
        await this.db
          .update(schema.orgPhoneNumbers)
          .set({
            organizationId,
            locationId,
            externalId: dto.telnyxPhoneNumberId || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.orgPhoneNumbers.phoneNumber, dto.phoneNumber));
      }
    }

    this.auditService.fireAndForget({
      action: 'location.updated',
      organizationId,
      entityId: locationId,
      entityType: 'locations',
      previousValue: { ...location },
      newValue: { ...updated },
    });

    return updated;
  }

  async updateAiConfig(
    organizationId: string,
    locationId: string,
    dto: UpdateAiConfigDto,
  ) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, locationId),
          eq(schema.locations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!location) {
      throw new NotFoundException('Location not found in your organization.');
    }

    const newAiSettings = {
      ...((location.aiSettings as Record<string, any>) || {}),
      ...(dto.aiSettings || {}),
    };

    await this.db
      .update(schema.locations)
      .set({ aiSettings: newAiSettings, updatedAt: new Date() })
      .where(eq(schema.locations.id, locationId));

    if (location.telnyxAssistantId) {
      // Only push instructions to Telnyx when explicitly provided — never auto-generate
      // a generic prompt that would overwrite the user's custom system prompt.
      if (dto.aiSettings?.instructions) {
        await this.telnyxService.updateAssistant(location.telnyxAssistantId, {
          instructions: dto.aiSettings.instructions,
        });
      }

      if (
        newAiSettings.dynamicVariables &&
        Object.keys(newAiSettings.dynamicVariables).length > 0
      ) {
        await this.telnyxService.updateAssistantDynamicVariable(
          location.telnyxAssistantId,
          newAiSettings.dynamicVariables,
        );
      }
    }

    this.auditService.fireAndForget({
      action: 'location.ai_config.updated',
      organizationId,
      entityId: locationId,
      entityType: 'locations',
      previousValue: location.aiSettings as Record<string, any>,
      newValue: newAiSettings,
    });

    return { message: 'AI Config updated and synced.' };
  }

  async assignManager(
    organizationId: string,
    locationId: string,
    inviterId: string,
    dto: AssignManagerDto,
  ) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, locationId),
          eq(schema.locations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!location) {
      throw new NotFoundException('Location not found in your organization.');
    }

    const [existingUser] = await this.db
      .select()
      .from(schema.users)
      .where(
        eq(sql`lower(${schema.users.email})`, dto.email.trim().toLowerCase()),
      )
      .limit(1);

    if (existingUser) {
      if (existingUser.organizationId !== organizationId) {
        throw new BadRequestException('User belongs to another organization.');
      }

      // Update existing user to manager and assign to this location
      await this.db
        .update(schema.users)
        .set({
          role: 'manager',
          locationId: locationId,
        })
        .where(eq(schema.users.id, existingUser.id));

      this.auditService.fireAndForget({
        action: 'location.manager.assigned',
        organizationId,
        entityId: locationId,
        userId: inviterId,
        newValue: { email: dto.email, role: 'manager' },
      });

      return { message: 'Existing user assigned as manager.' };
    }

    // User doesn't exist, create an invitation scoped to this location
    return this.invitationsService.createInvitation(organizationId, inviterId, {
      email: dto.email,
      role: 'manager',
      locationId,
    });
  }

  async deleteLocation(organizationId: string, locationId: string) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, locationId),
          eq(schema.locations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!location) {
      throw new NotFoundException('Location not found.');
    }

    await this.db
      .delete(schema.locations)
      .where(eq(schema.locations.id, locationId));

    this.auditService.fireAndForget({
      action: 'location.deleted',
      organizationId,
      entityId: locationId,
      entityType: 'locations',
      previousValue: { name: location.name },
    });

    return { message: 'Location deleted successfully.' };
  }
}
