import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { lt, eq, and, isNotNull, or } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { AuditService } from '../common/services/audit.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly auditService: AuditService,
    private readonly telnyxService: TelnyxService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredInvitations() {
    this.logger.log('Starting expired invitations sweep...');

    const expiredInvitations = await this.db
      .select()
      .from(schema.orgInvitations)
      .where(
        and(
          eq(schema.orgInvitations.status, 'pending'),
          lt(schema.orgInvitations.expiresAt, new Date()),
        ),
      );

    for (const inv of expiredInvitations) {
      await this.db
        .update(schema.orgInvitations)
        .set({ status: 'expired' })
        .where(eq(schema.orgInvitations.id, inv.id));

      this.auditService.fireAndForget({
        action: 'org.invitation.expired',
        organizationId: inv.organizationId,
        entityId: inv.id,
        entityType: 'org_invitations',
      });
      this.logger.log(`Marked invitation ${inv.id} as expired.`);
    }

    this.logger.log(`Swept ${expiredInvitations.length} expired invitations.`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepStuckProvisioning() {
    this.logger.log('Starting stuck provisioning sweep...');
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stuckSteps = await this.db
      .select()
      .from(schema.orgProvisioningSteps)
      .where(
        and(
          eq(schema.orgProvisioningSteps.status, 'in_progress'),
          isNotNull(schema.orgProvisioningSteps.startedAt),
          lt(schema.orgProvisioningSteps.startedAt, twentyFourHoursAgo),
        ),
      );

    for (const step of stuckSteps) {
      await this.db
        .update(schema.orgProvisioningSteps)
        .set({ status: 'failed', lastError: 'Timed out (stuck in progress)' })
        .where(eq(schema.orgProvisioningSteps.id, step.id));

      // Also update location to error
      await this.db
        .update(schema.locations)
        .set({
          status: 'provisioning',
          provisioningError: 'Timed out at step ' + step.stepName,
        })
        .where(eq(schema.locations.id, step.locationId));

      this.auditService.fireAndForget({
        action: 'org.provisioning.step_failed',
        organizationId: step.organizationId,
        entityId: step.id,
        entityType: 'org_provisioning_steps',
      });
      this.logger.error(
        `Marked step ${step.id} (${step.stepName}) as failed due to timeout.`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async enforceRetentionPolicy() {
    this.logger.log('Starting GDPR and retention policy enforcement sweep...');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const expiredRecordings = await this.db
      .select()
      .from(schema.recordings)
      .where(
        or(
          lt(schema.recordings.deletedAt, thirtyDaysAgo),
          lt(schema.recordings.expiresAt, now),
        ),
      );

    if (expiredRecordings.length === 0) {
      this.logger.log('No expired recordings found for hard deletion.');
      return;
    }

    let deletedCount = 0;
    for (const rec of expiredRecordings) {
      try {
        if (rec.objectKey) {
          await this.storageService.deleteObject(rec.objectKey);
        }
        await this.db
          .delete(schema.recordings)
          .where(eq(schema.recordings.id, rec.id));

        await this.db
          .delete(schema.conversations)
          .where(eq(schema.conversations.callSessionId, rec.callSessionId));

        deletedCount++;
      } catch (err: unknown) {
        this.logger.error(
          `Failed to hard delete recording ${rec.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`Hard deleted ${deletedCount} expired recordings.`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncTelnyxResources() {
    this.logger.log('Starting Telnyx resource sync...');

    // In a huge DB, we should paginate this.
    const activeLocations = await this.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.status, 'active'));

    for (const location of activeLocations) {
      if (location.telnyxAssistantId) {
        try {
          await this.telnyxService.getAssistant(location.telnyxAssistantId);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Location ${location.id} missing Telnyx assistant ${location.telnyxAssistantId}! (${msg})`,
          );
        }
      }

      if (location.telnyxPhoneNumberId) {
        try {
          await this.telnyxService.getPhoneNumber(location.telnyxPhoneNumberId);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Location ${location.id} missing Telnyx phone number ${location.telnyxPhoneNumberId}! (${msg})`,
          );
        }
      }

      // Delay to respect rate limits
      await new Promise((r) => setTimeout(r, 500));
    }

    this.logger.log('Finished Telnyx resource sync.');
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredRecordings() {
    this.logger.log('Starting GDPR and retention sweep for recordings...');

    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recordingsToDelete = await this.db
      .select()
      .from(schema.recordings)
      .where(
        or(
          and(
            isNotNull(schema.recordings.expiresAt),
            lt(schema.recordings.expiresAt, now),
          ),
          and(
            isNotNull(schema.recordings.deletedAt),
            lt(schema.recordings.deletedAt, thirtyDaysAgo),
          ),
        ),
      );

    for (const rec of recordingsToDelete) {
      if (rec.objectKey) {
        try {
          await this.storageService.deleteObject(rec.objectKey);
          this.logger.log(`Deleted S3 object ${rec.objectKey}`);
        } catch (e: unknown) {
          this.logger.error(
            `Failed to delete S3 object ${rec.objectKey}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      await this.db
        .delete(schema.recordings)
        .where(eq(schema.recordings.id, rec.id));

      this.auditService.fireAndForget({
        action: 'recording.hard_delete',
        organizationId: rec.organizationId,
        entityId: rec.id,
        entityType: 'recording',
      });
    }

    this.logger.log(`Swept ${recordingsToDelete.length} expired recordings.`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepWebhookEvents() {
    this.logger.log('Starting webhook events cleanup sweep...');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    try {
      const deleted = await this.db
        .delete(schema.webhookEvents)
        .where(lt(schema.webhookEvents.receivedAt, thirtyDaysAgo))
        .returning({ id: schema.webhookEvents.eventId });

      this.logger.log(`Swept ${deleted.length} expired webhook events.`);
    } catch (err: unknown) {
      this.logger.error(
        `Failed to sweep webhook events: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
