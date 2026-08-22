import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { generateUniqueSlug } from '../common/utils/slug.util';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, count } from 'drizzle-orm';
import { notDeleted } from '../database/db.utils';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateFeatureFlagsDto } from './dto/update-feature-flags.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { AuditService } from '../common/services/audit.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly auditService: AuditService,
  ) {}

  async getMyOrganization(orgId: string) {
    const results = await this.db
      .select()
      .from(schema.organizations)
      .where(
        notDeleted(schema.organizations, eq(schema.organizations.id, orgId)),
      )
      .limit(1);

    if (results.length === 0) {
      throw new NotFoundException('Organization not found.');
    }
    return results[0];
  }

  async updateMyOrganization(orgId: string, dto: UpdateOrganizationDto) {
    const org = await this.getMyOrganization(orgId);

    const [updated] = await this.db
      .update(schema.organizations)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, org.id))
      .returning();

    this.auditService.fireAndForget({
      action: 'organization.update',
      organizationId: updated.id,
      entityType: 'organization',
      entityId: updated.id,
      newValue: { ...dto },
    });

    return updated;
  }

  async updateFeatureFlags(orgId: string, dto: UpdateFeatureFlagsDto) {
    const org = await this.getMyOrganization(orgId);

    const mergedFlags = {
      ...((org.featureFlags as Record<string, boolean>) || {}),
      ...dto.flags,
    };

    const [updated] = await this.db
      .update(schema.organizations)
      .set({
        featureFlags: mergedFlags,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, org.id))
      .returning();

    this.auditService.fireAndForget({
      action: 'org.feature_flags.updated',
      organizationId: org.id,
      entityId: org.id,
      entityType: 'organizations',
      previousValue: { featureFlags: org.featureFlags },
      newValue: { featureFlags: updated.featureFlags },
    });

    return updated;
  }

  async listAllOrganizationsGlobal(
    pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { offset = 0, limit = 20 } = pagination;

    const data = await this.db
      .select()
      .from(schema.organizations)
      .where(notDeleted(schema.organizations))
      .orderBy(schema.organizations.createdAt)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.organizations)
      .where(notDeleted(schema.organizations));

    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }

  async createOrganizationGlobal(dto: CreateOrganizationDto) {
    const uniqueSlug = generateUniqueSlug(dto.name);

    const [newOrg] = await this.db
      .insert(schema.organizations)
      .values({
        ...dto,
        slug: uniqueSlug,
      })
      .returning();

    this.auditService.fireAndForget({
      action: 'organization.create',
      organizationId: newOrg.id,
      entityType: 'organization',
      entityId: newOrg.id,
      newValue: { name: dto.name, slug: uniqueSlug },
    });

    return newOrg;
  }

  async updateOrganizationGlobal(id: string, dto: UpdateOrganizationDto) {
    const org = await this.getMyOrganization(id);

    const [updated] = await this.db
      .update(schema.organizations)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, org.id))
      .returning();

    this.auditService.fireAndForget({
      action: 'organization.update',
      organizationId: updated.id,
      entityType: 'organization',
      entityId: updated.id,
      newValue: { ...dto },
    });

    return updated;
  }

  async deleteOrganizationGlobal(id: string) {
    const org = await this.getMyOrganization(id);

    const deletedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.organizations)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(eq(schema.organizations.id, org.id));

      // Cascade to locations. Deleting only the org left its locations live: they kept
      // their claim on the phone-number unique index (so the number could never be
      // reused) and still answered location-scoped queries.
      await tx
        .update(schema.locations)
        .set({ deletedAt, updatedAt: deletedAt, status: 'archived' })
        .where(
          notDeleted(
            schema.locations,
            eq(schema.locations.organizationId, org.id),
          ),
        );
    });

    this.auditService.fireAndForget({
      action: 'organization.delete',
      organizationId: org.id,
      entityType: 'organization',
      entityId: org.id,
    });

    return { success: true };
  }
}
