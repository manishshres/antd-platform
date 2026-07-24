/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { TelnyxService } from '../telnyx/telnyx.service';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from '../invitations/invitations.service';
import { AuditService } from '../common/services/audit.service';
import { randomBytes, createHash } from 'crypto';

import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Processor('provisioning-queue')
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly telnyxService: TelnyxService,
    private readonly configService: ConfigService,
    private readonly invitationsService: InvitationsService,
    private readonly auditService: AuditService,
    @InjectQueue('import-queue')
    private readonly importQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    if (job.name === 'provision-organization') {
      await this.handleProvisionOrganization(job.data);
    }
  }

  private async handleProvisionOrganization(data: {
    organizationId: string;
    locationId: string;
    adminEmail?: string;
  }) {
    const { organizationId, locationId, adminEmail } = data;

    // Fetch all steps ordered
    const steps = await this.db
      .select()
      .from(schema.orgProvisioningSteps)
      .where(
        and(
          eq(schema.orgProvisioningSteps.locationId, locationId),
          eq(schema.orgProvisioningSteps.organizationId, organizationId),
        ),
      )
      .orderBy(schema.orgProvisioningSteps.stepOrder);

    const pendingCount = steps.filter((s) => s.status === 'pending').length;
    if (pendingCount > 0) {
      this.auditService.fireAndForget({
        action: 'org.provisioning.started',
        organizationId,
      });
    }

    for (const step of steps) {
      if (step.status === 'completed' || step.status === 'skipped') {
        continue;
      }

      await this.updateStepStatus(step.id, 'in_progress');

      try {
        const metadata = (step.metadata as Record<string, any>) || {};
        const previousStepsMetadata =
          await this.getPreviousStepsMetadata(steps);

        switch (step.stepName) {
          case 'search_phone_number':
            await this.searchPhoneNumber(locationId, metadata);
            break;
          case 'purchase_phone_number':
            await this.purchasePhoneNumber(
              locationId,
              metadata,
              previousStepsMetadata,
            );
            break;
          case 'clone_agent':
            await this.cloneAgent(locationId, metadata);
            break;
          case 'assign_phone_to_agent':
            await this.assignPhoneToAgent(
              locationId,
              metadata,
              previousStepsMetadata,
            );
            break;
          case 'configure_agent':
            await this.configureAgent(locationId, previousStepsMetadata);
            break;
          case 'import_menu':
            await this.importMenu(locationId);
            break;
          case 'register_webhook':
            await this.registerWebhook(organizationId, locationId);
            break;
          case 'send_admin_invitation':
            if (adminEmail) {
              await this.sendAdminInvitation(organizationId, adminEmail);
            } else {
              this.logger.warn(
                `No adminEmail provided for org ${organizationId}, skipping invitation.`,
              );
            }
            break;
          default:
            this.logger.warn(`Unknown step: ${step.stepName}`);
        }

        await this.updateStepStatus(step.id, 'completed', metadata);
        this.auditService.fireAndForget({
          action: 'org.provisioning.step_completed',
          organizationId,
          entityId: step.id,
          entityType: 'org_provisioning_steps',
        });
      } catch (err: any) {
        this.logger.error(
          `Failed step ${step.stepName} for location ${locationId}: ${err.message}`,
        );
        await this.updateStepStatus(step.id, 'failed', undefined, err.message);

        this.auditService.fireAndForget({
          action: 'org.provisioning.step_failed',
          organizationId,
          entityId: step.id,
          entityType: 'org_provisioning_steps',
        });

        // Stop processing further steps for this location
        await this.db
          .update(schema.locations)
          .set({ status: 'provisioning', provisioningError: err.message })
          .where(eq(schema.locations.id, locationId));

        throw err;
      }
    }

    // All steps complete
    await this.db
      .update(schema.locations)
      .set({ status: 'active', provisioningCompletedAt: new Date() })
      .where(eq(schema.locations.id, locationId));

    await this.db
      .update(schema.organizations)
      .set({ status: 'active' })
      .where(eq(schema.organizations.id, organizationId));

    this.logger.log(
      `Successfully provisioned org ${organizationId} location ${locationId}`,
    );

    this.auditService.fireAndForget({
      action: 'org.provisioning.completed',
      organizationId,
    });
  }

  // --- Step Implementations ---

  private async searchPhoneNumber(
    locationId: string,
    metadata: Record<string, any>,
  ) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);

    if (location.phoneNumber) {
      this.logger.log(`Using provided phone number: ${location.phoneNumber}`);
      metadata.selectedPhoneNumber = location.phoneNumber;
      return;
    }

    // In real implementation we use location.country, state, city.
    const res: any = await this.telnyxService.searchAvailableNumbers(
      location.country || 'US',
      location.state || undefined,
      location.city || undefined,
      1,
    );

    if (!res.data || res.data.length === 0) {
      throw new Error('No phone numbers available for the specified criteria.');
    }

    metadata.selectedPhoneNumber = res.data[0].phone_number;
  }

  private async purchasePhoneNumber(
    locationId: string,
    metadata: Record<string, any>,
    previousMetadata: Record<string, any>,
  ) {
    const phoneNumber =
      previousMetadata.search_phone_number?.selectedPhoneNumber;
    if (!phoneNumber)
      throw new Error('No phone number found from previous step.');

    const res: any = await this.telnyxService.createNumberOrder(phoneNumber);

    // In reality, this is async and we need to poll or handle webhooks,
    // but for the sake of this phase we'll just store the ID and wait briefly.
    metadata.numberOrderId = res.data?.id;
    metadata.phoneNumber = phoneNumber;

    // Simulate polling for completion
    let status = 'pending';
    let attempts = 0;
    while (status !== 'success' && attempts < 10) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes: any = await this.telnyxService.getNumberOrder(
        metadata.numberOrderId,
      );
      status = pollRes.data?.status;
      if (status === 'failure')
        throw new Error('Phone number purchase failed upstream.');
      attempts++;
    }

    if (status !== 'success') {
      throw new Error('Phone number purchase timed out.');
    }

    // Fetch the actual phone number ID from Telnyx
    const purchasedPhoneRes: any =
      await this.telnyxService.getPhoneNumbersByNumber(metadata.phoneNumber);
    if (purchasedPhoneRes.data && purchasedPhoneRes.data.length > 0) {
      metadata.telnyxPhoneNumberId = purchasedPhoneRes.data[0].id;
    } else {
      throw new Error('Phone number purchased but could not retrieve its ID.');
    }

    await this.db
      .update(schema.locations)
      .set({
        phoneNumber: metadata.phoneNumber,
        telnyxPhoneNumberId: metadata.telnyxPhoneNumberId,
      })
      .where(eq(schema.locations.id, locationId));
  }

  private async cloneAgent(locationId: string, metadata: Record<string, any>) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);

    const aiSettings = location.aiSettings as Record<string, any> | null;
    let masterAgentId = aiSettings?.baseAgentId;

    if (!masterAgentId) {
      masterAgentId = this.configService.get<string>('TELNYX_MASTER_AGENT_ID');
    }

    if (!masterAgentId)
      throw new Error(
        'No base agent selected and TELNYX_MASTER_AGENT_ID not configured.',
      );

    const res: any = await this.telnyxService.cloneAssistant(masterAgentId);
    const assistantId = res.id || res.data?.id;
    if (!assistantId) throw new Error('Failed to clone assistant.');

    const texmlAppId =
      res.telephony_settings?.default_texml_app_id ||
      res.data?.telephony_settings?.default_texml_app_id;

    metadata.assistantId = assistantId;
    metadata.masterAgentId = masterAgentId;
    if (texmlAppId) {
      metadata.texmlAppId = texmlAppId;
    }

    await this.db
      .update(schema.locations)
      .set({
        telnyxAssistantId: metadata.assistantId,
        masterAgentId: metadata.masterAgentId,
      })
      .where(eq(schema.locations.id, locationId));
  }

  private async assignPhoneToAgent(
    locationId: string,
    metadata: Record<string, any>,
    previousMetadata: Record<string, any>,
  ) {
    const telnyxPhoneNumberId =
      previousMetadata.purchase_phone_number?.telnyxPhoneNumberId;

    // Use the newly created AI Agent's TeXML App ID, or fallback to the config
    const texmlAppId = previousMetadata.clone_agent?.texmlAppId;
    const connectionId =
      texmlAppId || this.configService.get<string>('TELNYX_CONNECTION_ID');

    if (!telnyxPhoneNumberId)
      throw new Error('No telnyxPhoneNumberId from previous step.');
    if (!connectionId)
      throw new Error(
        'No TeXML App ID found on agent and TELNYX_CONNECTION_ID not configured.',
      );

    // We assign the connection to the phone number.
    // The connection (TexML app) will route calls to the Assistant via webhook.
    await this.telnyxService.updatePhoneNumber(telnyxPhoneNumberId, {
      connection_id: connectionId,
      call_recording_enabled: true,
    });
  }

  private async configureAgent(
    locationId: string,
    previousMetadata: Record<string, any>,
  ) {
    const assistantId = previousMetadata.clone_agent?.assistantId;
    if (!assistantId) throw new Error('No assistantId from previous step.');

    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);

    const [org] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, location.organizationId))
      .limit(1);

    const aiSettings = location.aiSettings as Record<string, any> | null;

    const payload: Record<string, any> = {
      name: `${location.name} Assistant`,
    };

    if (aiSettings?.dynamicVariables) {
      payload.dynamic_variables = aiSettings.dynamicVariables;
    }

    await this.telnyxService.updateAssistant(assistantId, payload);
  }

  private async importMenu(locationId: string) {
    const [location] = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);

    const aiSettings = location.aiSettings as Record<string, any> | null;
    if (aiSettings?.menuUrl) {
      this.logger.log(`Queueing menu import from ${aiSettings.menuUrl}`);
      await this.importQueue.add('import-menu', {
        orgId: location.organizationId,
        url: aiSettings.menuUrl,
        locationId,
      });
    } else {
      this.logger.log(`No menuUrl provided, skipping menu import.`);
    }
  }

  private async registerWebhook(organizationId: string, locationId: string) {
    // Generate a webhook API key for the organization
    const newKey = `sk_live_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(newKey).digest('hex');

    await this.db
      .update(schema.locations)
      .set({
        webhookApiKey: keyHash,
      })
      .where(eq(schema.locations.id, locationId));

    // Set on org as well for backward compatibility if needed, or just keep on location
    await this.db
      .update(schema.organizations)
      .set({
        webhookApiKey: keyHash,
      })
      .where(eq(schema.organizations.id, organizationId));
  }

  private async sendAdminInvitation(
    organizationId: string,
    adminEmail: string,
  ) {
    // Determine a "system" user id or just pass a generic sysadmin ID if available.
    // For platform provisioning, the inviter is the platform admin who triggered it,
    // but the processor doesn't have the user context. We can set it to null or a placeholder.
    // Let's pass a dummy UUID for the system inviter.
    const systemUserId = '00000000-0000-0000-0000-000000000000';

    await this.invitationsService.createInvitation(
      organizationId,
      systemUserId,
      {
        email: adminEmail,
        role: 'sysadmin',
      },
    );
    this.logger.log(`Admin invitation sent to ${adminEmail}`);
  }

  // --- Helpers ---

  private async updateStepStatus(
    stepId: string,
    status: string,
    metadata?: any,
    error?: string,
  ) {
    const updatePayload: any = { status };
    if (metadata) updatePayload.metadata = metadata;
    if (error) updatePayload.lastError = error;
    if (status === 'in_progress') updatePayload.startedAt = new Date();
    if (status === 'completed' || status === 'failed')
      updatePayload.completedAt = new Date();

    // Increment attempts if it was just started
    if (status === 'in_progress') {
      const [step] = await this.db
        .select({ attempts: schema.orgProvisioningSteps.attempts })
        .from(schema.orgProvisioningSteps)
        .where(eq(schema.orgProvisioningSteps.id, stepId))
        .limit(1);
      updatePayload.attempts = (step?.attempts || 0) + 1;
    }

    await this.db
      .update(schema.orgProvisioningSteps)
      .set(updatePayload)
      .where(eq(schema.orgProvisioningSteps.id, stepId));
  }

  private async getPreviousStepsMetadata(
    steps: any[],
  ): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const step of steps) {
      if (step.metadata) {
        result[step.stepName] = step.metadata;
      }
    }
    return result;
  }
}
