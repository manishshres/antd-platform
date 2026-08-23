import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, inArray } from 'drizzle-orm';
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

  /**
   * Postgres unique-violation code. The partial indexes on organizations(lower(name)) and
   * locations(organization_id, lower(name)) are what actually stop a duplicate — the
   * pre-flight checks below lose to a simultaneous second submit, which is exactly the
   * double-click case. Translate the raw violation into a 409 the UI can show.
   */
  private static readonly UNIQUE_VIOLATION = '23505';

  private async runOrConflict<T>(
    work: () => Promise<T>,
    message: string,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === ProvisioningService.UNIQUE_VIOLATION) {
        throw new ConflictException(message);
      }
      throw error;
    }
  }

  /** Rejects a name already held by a live organization (case-insensitive). */
  private async assertOrganizationNameFree(name: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(
        notDeleted(
          schema.organizations,
          sql`lower(${schema.organizations.name}) = lower(${name})`,
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException(
        `An organization named "${name}" already exists. Rename it, or deprovision the existing one first.`,
      );
    }
  }

  /** Rejects a location name already used within the same organization. */
  private async assertLocationNameFree(
    organizationId: string,
    name: string,
  ): Promise<void> {
    const [existing] = await this.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(
        notDeleted(
          schema.locations,
          and(
            eq(schema.locations.organizationId, organizationId),
            sql`lower(${schema.locations.name}) = lower(${name})`,
          ),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException(
        `This organization already has a location named "${name}".`,
      );
    }
  }

  async createOrganizationProvisioning(dto: CreateOrgProvisionDto) {
    // Reject the duplicate before any Telnyx work happens. The DB index is the real
    // guarantee (two simultaneous submits both pass this check), but reaching it first
    // gives a usable message instead of a raw constraint violation.
    await this.assertOrganizationNameFree(dto.orgName);

    const uniqueSlug = generateUniqueSlug(dto.orgName);
    const uniqueLocationSlug = generateUniqueSlug(dto.locationName);

    // When reusing the agent's number we resolve and claim it up front, before any row is
    // written — a conflict here should fail the request outright rather than leave a
    // half-provisioned org behind.
    let reusedNumber: {
      phoneNumber: string;
      telnyxPhoneNumberId: string;
    } | null = null;

    if (dto.useAgentPhoneNumber) {
      if (!dto.baseAgentId) {
        throw new BadRequestException(
          'baseAgentId is required when reusing the agent phone number.',
        );
      }
      reusedNumber = await this.resolveAgentPhoneNumberForClaim(
        dto.baseAgentId,
      );
    }

    const result = await this.runOrConflict(
      () =>
        this.db.transaction(async (tx) => {
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
              phoneNumber: reusedNumber?.phoneNumber ?? dto.phoneNumber ?? null,
              telnyxPhoneNumberId: reusedNumber?.telnyxPhoneNumberId ?? null,
              aiSettings: {
                baseAgentId: dto.baseAgentId,
                dynamicVariables: dto.dynamicVariables,
                menuUrl: dto.menuUrl,
                useAgentPhoneNumber: dto.useAgentPhoneNumber ?? false,
              },
              status: 'provisioning',
            })
            .returning();

          // 3. Create Provisioning Steps — the search/purchase pair is omitted entirely when
          // reusing the agent's number, so no billable number order is ever placed.
          const steps = [
            ...(reusedNumber
              ? []
              : ['search_phone_number', 'purchase_phone_number']),
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

          // 4. Create a default free subscription for this location
          await tx.insert(schema.subscriptions).values({
            organizationId: newOrg.id,
            locationId: newLocation.id,
            planId: 'free',
            status: 'active',
          });

          return { organizationId: newOrg.id, locationId: newLocation.id };
        }),
      `An organization named "${dto.orgName}" already exists.`,
    );

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
    const res = await this.telnyxService.getAssistants();
    return (res.data ?? []).map((a) => ({
      id: a.id,
      name: a.name ?? 'Unnamed Agent',
      dynamicVariables: a.dynamic_variables ?? {},
    }));
  }

  /**
   * The numbers currently routed to `agentId`, each flagged with whether a location has
   * already claimed it. A number backs at most one location, so the wizard can grey out
   * the ones that are taken instead of failing at submit time.
   */
  async getAgentPhoneNumbers(agentId: string) {
    const texmlAppId = await this.getAgentTexmlAppId(agentId);
    if (!texmlAppId) return [];

    const res =
      await this.telnyxService.getPhoneNumbersByConnection(texmlAppId);
    const numbers = (res.data ?? []).filter((n) => n.phone_number && n.id);
    if (numbers.length === 0) return [];

    const claimed = await this.db
      .select({
        locationId: schema.locations.id,
        locationName: schema.locations.name,
        phoneNumber: schema.locations.phoneNumber,
      })
      .from(schema.locations)
      .where(
        and(
          inArray(
            schema.locations.phoneNumber,
            numbers.map((n) => n.phone_number!),
          ),
          notDeleted(schema.locations),
        ),
      );

    return numbers.map((n) => {
      const owner = claimed.find((c) => c.phoneNumber === n.phone_number);
      return {
        phoneNumber: n.phone_number!,
        telnyxPhoneNumberId: n.id!,
        claimedByLocationId: owner?.locationId ?? null,
        claimedByLocationName: owner?.locationName ?? null,
      };
    });
  }

  /**
   * The TeXML app a number must be routed through to count as this agent's. Telnyx returns
   * the assistant either bare or wrapped in `data` depending on the endpoint, so check both.
   */
  private async getAgentTexmlAppId(agentId: string): Promise<string | null> {
    const assistant = await this.telnyxService.getAssistant(agentId);
    return (
      assistant.telephony_settings?.default_texml_app_id ??
      assistant.data?.telephony_settings?.default_texml_app_id ??
      null
    );
  }

  /** Picks the agent's first unclaimed number, or explains why none is usable. */
  private async resolveAgentPhoneNumberForClaim(agentId: string) {
    // Distinguish the two ways this comes up empty. Collapsing them into one message sent
    // operators looking for a missing number when the agent had no TeXML app at all.
    const texmlAppId = await this.getAgentTexmlAppId(agentId);
    if (!texmlAppId) {
      throw new BadRequestException(
        'The selected agent has no telephony app configured in Telnyx, so no number can be traced to it. Attach one to the assistant, or provision a new number instead.',
      );
    }

    const numbers = await this.getAgentPhoneNumbers(agentId);

    if (numbers.length === 0) {
      throw new BadRequestException(
        "No phone numbers are routed to the selected agent's telephony app. Provision a new number instead.",
      );
    }

    const free = numbers.find((n) => !n.claimedByLocationId);
    if (!free) {
      throw new ConflictException(
        `The agent's number (${numbers[0].phoneNumber}) is already assigned to "${numbers[0].claimedByLocationName ?? 'another location'}". One number can back only one location.`,
      );
    }

    return {
      phoneNumber: free.phoneNumber,
      telnyxPhoneNumberId: free.telnyxPhoneNumberId,
    };
  }

  async searchAvailableNumbers(country: string, state?: string, city?: string) {
    const res = await this.telnyxService.searchAvailableNumbers(
      country || 'US',
      state,
      city,
      10, // return up to 10 numbers
    );

    return (res.data ?? []).map((n) => ({
      phoneNumber: n.phone_number,
      formatted: n.national_format ?? n.phone_number,
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

    await this.assertLocationNameFree(organizationId, dto.locationName);

    const uniqueLocationSlug = generateUniqueSlug(dto.locationName);

    const result = await this.runOrConflict(
      () =>
        this.db.transaction(async (tx) => {
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
        }),
      `This organization already has a location named "${dto.locationName}".`,
    );

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
      // Soft-deleted orgs were still counted here, so a deprovisioned company kept
      // showing up in the provisioning dashboard long after it was gone.
      .where(notDeleted(schema.organizations))
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
      .where(
        notDeleted(
          schema.organizations,
          eq(schema.orgProvisioningSteps.status, 'failed'),
        ),
      )
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

  async getProvisioningStatus(organizationId: string, locationId?: string) {
    const [org] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    if (!org) throw new NotFoundException('Organization not found.');

    const locationsQuery = this.db
      .select()
      .from(schema.locations)
      .where(
        locationId
          ? and(
              eq(schema.locations.organizationId, org.id),
              eq(schema.locations.id, locationId),
            )
          : eq(schema.locations.organizationId, org.id),
      );

    const locations = await locationsQuery;
    if (locations.length === 0)
      throw new NotFoundException('Location not found.');

    const locationsWithSteps = await Promise.all(
      locations.map(async (loc) => {
        const steps = await this.db
          .select()
          .from(schema.orgProvisioningSteps)
          .where(eq(schema.orgProvisioningSteps.locationId, loc.id))
          .orderBy(schema.orgProvisioningSteps.stepOrder);

        return {
          locationId: loc.id,
          locationName: loc.name,
          locationStatus: loc.status,
          provisioningError: loc.provisioningError,
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
      }),
    );

    return {
      organizationId: org.id,
      organizationStatus: org.status,
      locations: locationsWithSteps,
      // Backward compatibility fields for single location
      locationId: locationsWithSteps[0]?.locationId,
      locationStatus: locationsWithSteps[0]?.locationStatus,
      provisioningError: locationsWithSteps[0]?.provisioningError,
      steps: locationsWithSteps[0]?.steps || [],
    };
  }

  async retryProvisioning(organizationId: string, targetLocationId?: string) {
    const status = await this.getProvisioningStatus(
      organizationId,
      targetLocationId,
    );
    const locId = targetLocationId || status.locationId;

    const [loc] = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, locId))
      .limit(1);

    if (!loc) throw new NotFoundException('Location not found.');

    if (loc.status === 'active') {
      throw new BadRequestException('Location is already active.');
    }

    await this.db
      .update(schema.locations)
      .set({ status: 'provisioning', provisioningError: null })
      .where(eq(schema.locations.id, locId));

    // M5 fix: Only mark org as provisioning if it isn't already active
    const [org] = await this.db
      .select({ status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);

    if (org?.status !== 'active') {
      await this.db
        .update(schema.organizations)
        .set({ status: 'provisioning' })
        .where(eq(schema.organizations.id, organizationId));
    }

    // Reset failed *and* stranded steps to pending. Only 'failed' was reset before, so a
    // step whose worker died mid-run — Redis restart, deploy, crash — stayed 'in_progress'
    // forever and the admin panel showed provisioning parked on that step with no way to
    // clear it. Nothing is in flight at this point: this is the retry path, and any job
    // that owned these rows is gone.
    await this.db
      .update(schema.orgProvisioningSteps)
      .set({ status: 'pending', lastError: null })
      .where(
        and(
          eq(schema.orgProvisioningSteps.locationId, locId),
          inArray(schema.orgProvisioningSteps.status, [
            'failed',
            'in_progress',
          ]),
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
      const aiSettings = location.aiSettings as Record<string, unknown> | null;
      const reusedNumber = aiSettings?.useAgentPhoneNumber === true;

      // A reused number belongs to the base agent, not to this location — releasing it
      // would delete a number we never bought and break the agent it came from.
      if (location.telnyxPhoneNumberId && !reusedNumber) {
        try {
          await this.telnyxService.deletePhoneNumber(
            location.telnyxPhoneNumberId,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to delete phone number ${location.telnyxPhoneNumberId} from Telnyx: ${(error as Error).message}`,
          );
        }
      } else if (location.telnyxPhoneNumberId && reusedNumber) {
        this.logger.log(
          `Keeping phone number ${location.telnyxPhoneNumberId} — it was reused from the base agent, not purchased.`,
        );
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
