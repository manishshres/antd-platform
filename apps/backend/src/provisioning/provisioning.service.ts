import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { CreateOrgProvisionDto } from './dto/create-org-provision.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { generateUniqueSlug } from '../common/utils/slug.util';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AuditService } from '../common/services/audit.service';
import { sql } from 'drizzle-orm';
import { notDeleted } from '../database/db.utils';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('provisioning-queue')
    private readonly provisioningQueue: Queue,
    private readonly telnyxService: TelnyxService,
    private readonly auditService: AuditService,
  ) {}

  async createOrganizationProvisioning(dto: CreateOrgProvisionDto) {
    const uniqueSlug = generateUniqueSlug(dto.orgName);
    const uniqueLocationSlug = generateUniqueSlug(dto.locationName);

    const result = await this.db.transaction(async (tx) => {
      // 1. Create Organization
      const [newOrg] = await tx
        .insert(schema.organizations)
        .values({
          name: dto.orgName,
          slug: uniqueSlug,
          status: 'provisioning',
        })
        .returning();

      // 2. Create Location
      const [newLocation] = await tx
        .insert(schema.locations)
        .values({
          organizationId: newOrg.id,
          name: dto.locationName,
          slug: uniqueLocationSlug,
          country: dto.country,
          state: dto.state,
          city: dto.city,
          phoneNumber: dto.phoneNumber || null,
          aiSettings: {
            baseAgentId: dto.baseAgentId,
            dynamicVariables: dto.dynamicVariables,
            menuUrl: dto.menuUrl,
          },
          status: 'provisioning',
        })
        .returning();

      // 3. Create Provisioning Steps
      const steps = [
        'search_phone_number',
        'purchase_phone_number',
        'clone_agent',
        'assign_phone_to_agent',
        'configure_agent',
        'import_menu',
        'register_webhook',
        'send_admin_invitation',
      ];

      for (let i = 0; i < steps.length; i++) {
        await tx.insert(schema.orgProvisioningSteps).values({
          organizationId: newOrg.id,
          locationId: newLocation.id,
          stepName: steps[i],
          stepOrder: i + 1,
          status: 'pending',
        });
      }

      return { organizationId: newOrg.id, locationId: newLocation.id };
    });

    // Enqueue job
    await this.provisioningQueue.add(
      'provision-organization',
      {
        organizationId: result.organizationId,
        locationId: result.locationId,
        adminEmail: dto.adminEmail,
      },
      {
        jobId: `provision-${result.locationId}`,
      },
    );

    this.logger.log(`Provisioning started for org ${result.organizationId}`);

    this.auditService.fireAndForget({
      action: 'org.created',
      organizationId: result.organizationId,
    });

    return {
      message: 'Provisioning started',
      organizationId: result.organizationId,
      locationId: result.locationId,
    };
  }

  async listTelnyxAssistants() {
    const res: any = await this.telnyxService.getAssistants();
    if (!res.data) return [];
    return res.data.map((a: any) => ({
      id: a.id,
      name: a.name || 'Unnamed Agent',
      dynamicVariables: a.dynamic_variables || {},
    }));
  }

  async searchAvailableNumbers(country: string, state?: string, city?: string) {
    const res: any = await this.telnyxService.searchAvailableNumbers(
      country || 'US',
      state,
      city,
      10, // return up to 10 numbers
    );

    if (!res.data || res.data.length === 0) {
      return [];
    }

    return res.data.map((n: any) => ({
      phoneNumber: n.phone_number,
      formatted: n.national_format || n.phone_number,
    }));
  }

  async addLocationProvisioning(
    organizationId: string,
    dto: import('./dto/add-location-provisioning.dto').AddLocationProvisioningDto,
  ) {
    const org = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    if (org.length === 0) {
      throw new NotFoundException('Organization not found');
    }

    const uniqueLocationSlug = generateUniqueSlug(dto.locationName);

    const result = await this.db.transaction(async (tx) => {
      // 1. Create Location
      const [newLocation] = await tx
        .insert(schema.locations)
        .values({
          organizationId: organizationId,
          name: dto.locationName,
          slug: uniqueLocationSlug,
          country: dto.country,
          state: dto.state,
          city: dto.city,
          status: 'provisioning',
        })
        .returning();

      // 2. Create Provisioning Steps for a new location
      const steps = [
        'search_phone_number',
        'purchase_phone_number',
        'clone_agent',
        'assign_phone_to_agent',
        'configure_agent',
      ];

      for (let i = 0; i < steps.length; i++) {
        await tx.insert(schema.orgProvisioningSteps).values({
          organizationId: organizationId,
          locationId: newLocation.id,
          stepName: steps[i],
          stepOrder: i + 1,
          status: 'pending',
        });
      }

      // 3. Create a default subscription for this location
      await tx.insert(schema.subscriptions).values({
        organizationId: organizationId,
        locationId: newLocation.id,
        planId: 'free',
        status: 'active',
      });

      return { organizationId, locationId: newLocation.id };
    });

    // Enqueue job to provision the location resources
    await this.provisioningQueue.add(
      'provision-organization',
      {
        organizationId: result.organizationId,
        locationId: result.locationId,
      },
      {
        jobId: `provision-${result.locationId}`,
      },
    );

    this.logger.log(
      `Provisioning started for location ${result.locationId} in org ${result.organizationId}`,
    );

    this.auditService.fireAndForget({
      action: 'location.created',
      organizationId: result.organizationId,
      entityId: result.locationId,
    });

    return {
      message: 'Location provisioning started',
      organizationId: result.organizationId,
      locationId: result.locationId,
    };
  }

  async getProvisioningSummary() {
    const results = await this.db
      .select({
        status: schema.organizations.status,
        count: sql<number>`cast(count(${schema.organizations.id}) as int)`,
      })
      .from(schema.organizations)
      .groupBy(schema.organizations.status);

    const summary = {
      draft: 0,
      provisioning: 0,
      active: 0,
      suspended: 0,
      archived: 0,
    };

    results.forEach((row) => {
      if (row.status && row.status in summary) {
        summary[row.status as keyof typeof summary] = row.count;
      }
    });

    return summary;
  }

  async getProvisioningFailures() {
    const failedSteps = await this.db
      .select({
        stepId: schema.orgProvisioningSteps.id,
        organizationId: schema.orgProvisioningSteps.organizationId,
        locationId: schema.orgProvisioningSteps.locationId,
        stepName: schema.orgProvisioningSteps.stepName,
        error: schema.orgProvisioningSteps.lastError,
        orgName: schema.organizations.name,
      })
      .from(schema.orgProvisioningSteps)
      .innerJoin(
        schema.organizations,
        eq(schema.orgProvisioningSteps.organizationId, schema.organizations.id),
      )
      .where(eq(schema.orgProvisioningSteps.status, 'failed'))
      .orderBy(desc(schema.orgProvisioningSteps.startedAt));

    return failedSteps;
  }

  async listOrganizations() {
    return this.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        status: schema.organizations.status,
        createdAt: schema.organizations.createdAt,
      })
      .from(schema.organizations)
      .where(notDeleted(schema.organizations))
      .orderBy(desc(schema.organizations.createdAt));
  }

  async getProvisioningStatus(organizationId: string) {
    const [org] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    if (!org) throw new NotFoundException('Organization not found.');

    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.organizationId, org.id))
      .limit(1);

    if (!location) throw new NotFoundException('Location not found.');

    const steps = await this.db
      .select()
      .from(schema.orgProvisioningSteps)
      .where(eq(schema.orgProvisioningSteps.locationId, location.id))
      .orderBy(schema.orgProvisioningSteps.stepOrder);

    return {
      organizationId: org.id,
      locationId: location.id,
      organizationStatus: org.status,
      locationStatus: location.status,
      provisioningError: location.provisioningError,
      steps: steps.map((s) => ({
        id: s.id,
        stepName: s.stepName,
        stepOrder: s.stepOrder,
        status: s.status,
        attempts: s.attempts,
        lastError: s.lastError,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    };
  }

  async retryProvisioning(organizationId: string) {
    const status = await this.getProvisioningStatus(organizationId);

    if (status.locationStatus === 'active') {
      throw new BadRequestException('Location is already active.');
    }

    await this.db
      .update(schema.locations)
      .set({ status: 'provisioning', provisioningError: null })
      .where(eq(schema.locations.id, status.locationId));

    await this.db
      .update(schema.organizations)
      .set({ status: 'provisioning' })
      .where(eq(schema.organizations.id, status.organizationId));

    // Reset failed steps to pending
    await this.db
      .update(schema.orgProvisioningSteps)
      .set({ status: 'pending', lastError: null })
      .where(
        and(
          eq(schema.orgProvisioningSteps.locationId, status.locationId),
          eq(schema.orgProvisioningSteps.status, 'failed'),
        ),
      );

    // Retrieve admin email from the first pending org invitation if any,
    // or just re-queue with whatever context we have.
    // In a real app we might store adminEmail in the location or metadata.
    // For now we assume the processor handles missing adminEmail if invitation was already sent.
    await this.provisioningQueue.add(
      'provision-organization',
      {
        organizationId: status.organizationId,
        locationId: status.locationId,
        adminEmail: null,
      },
      {
        jobId: `provision-${status.locationId}-${Date.now()}`,
      },
    );

    return { message: 'Provisioning retried.' };
  }

  async retryStep(organizationId: string, stepId: string) {
    const [step] = await this.db
      .select()
      .from(schema.orgProvisioningSteps)
      .where(
        and(
          eq(schema.orgProvisioningSteps.id, stepId),
          eq(schema.orgProvisioningSteps.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!step) throw new NotFoundException('Step not found.');

    await this.db
      .update(schema.orgProvisioningSteps)
      .set({ status: 'pending', lastError: null })
      .where(eq(schema.orgProvisioningSteps.id, step.id));

    await this.retryProvisioning(organizationId);

    return { message: 'Step retried.' };
  }

  async skipStep(organizationId: string, stepId: string) {
    const [step] = await this.db
      .select()
      .from(schema.orgProvisioningSteps)
      .where(
        and(
          eq(schema.orgProvisioningSteps.id, stepId),
          eq(schema.orgProvisioningSteps.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!step) throw new NotFoundException('Step not found.');

    await this.db
      .update(schema.orgProvisioningSteps)
      .set({ status: 'completed', lastError: null })
      .where(eq(schema.orgProvisioningSteps.id, step.id));

    this.auditService.fireAndForget({
      action: 'org.provisioning.step_skipped',
      organizationId,
      entityId: step.id,
      entityType: 'org_provisioning_steps',
    });

    await this.retryProvisioning(organizationId);

    return { message: 'Step skipped.' };
  }

  async deprovision(organizationId: string) {
    const locations = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.organizationId, organizationId));

    for (const location of locations) {
      if (location.telnyxPhoneNumberId) {
        try {
          await this.telnyxService.deletePhoneNumber(
            location.telnyxPhoneNumberId,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to delete phone number ${location.telnyxPhoneNumberId} from Telnyx: ${(error as Error).message}`,
          );
        }
      }

      if (location.telnyxAssistantId) {
        try {
          await this.telnyxService.deleteAssistant(location.telnyxAssistantId);
        } catch (error) {
          this.logger.warn(
            `Failed to delete assistant ${location.telnyxAssistantId} from Telnyx: ${(error as Error).message}`,
          );
        }
      }
    }

    await this.db
      .update(schema.organizations)
      .set({ status: 'archived', deletedAt: new Date() })
      .where(eq(schema.organizations.id, organizationId));

    await this.db
      .update(schema.locations)
      .set({ status: 'archived', deletedAt: new Date() })
      .where(eq(schema.locations.organizationId, organizationId));

    this.auditService.fireAndForget({
      action: 'org.deprovisioned',
      organizationId,
    });

    return { message: 'Organization deprovisioned and archived.' };
  }

  async setStatus(organizationId: string, status: string) {
    if (status !== 'active' && status !== 'suspended') {
      throw new BadRequestException('Status must be active or suspended');
    }

    await this.db
      .update(schema.organizations)
      .set({ status })
      .where(eq(schema.organizations.id, organizationId));

    this.auditService.fireAndForget({
      action: status === 'suspended' ? 'org.suspended' : 'org.reactivated',
      organizationId,
    });

    return { message: `Organization status set to ${status}.` };
  }

  async updateOrganization(
    organizationId: string,
    updates: Record<string, unknown>,
  ) {
    const allowedUpdates: Partial<typeof schema.organizations.$inferInsert> =
      {};
    if (updates.featureFlags !== undefined) {
      allowedUpdates.featureFlags = updates.featureFlags;
    }

    if (Object.keys(allowedUpdates).length === 0) {
      throw new BadRequestException('No valid fields to update');
    }

    await this.db
      .update(schema.organizations)
      .set(allowedUpdates)
      .where(eq(schema.organizations.id, organizationId));

    this.auditService.fireAndForget({
      action: 'org.updated',
      organizationId,
      newValue: allowedUpdates,
    });

    return { message: 'Organization updated.' };
  }
}
