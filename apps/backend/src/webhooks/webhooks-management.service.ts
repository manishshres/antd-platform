import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { CreateOrgWebhookDto } from './dto/create-org-webhook.dto';
import { AuditService } from '../common/services/audit.service';
import { randomBytes } from 'crypto';

@Injectable()
export class WebhooksManagementService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly auditService: AuditService,
  ) {}

  async listEndpoints(organizationId: string) {
    return this.db
      .select()
      .from(schema.orgWebhooks)
      .where(eq(schema.orgWebhooks.organizationId, organizationId));
  }

  async createEndpoint(organizationId: string, dto: CreateOrgWebhookDto) {
    const secret = randomBytes(32).toString('hex');
    const [webhook] = await this.db
      .insert(schema.orgWebhooks)
      .values({
        organizationId,
        url: dto.url,
        events: dto.events,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        secret,
      })
      .returning();

    void this.auditService.log({
      action: 'org.webhook.created',
      organizationId,
      entityId: webhook.id,
      entityType: 'org_webhooks',
      newValue: { url: dto.url, events: dto.events },
    });

    return webhook;
  }

  async deleteEndpoint(organizationId: string, id: string) {
    const [deleted] = await this.db
      .delete(schema.orgWebhooks)
      .where(
        and(
          eq(schema.orgWebhooks.id, id),
          eq(schema.orgWebhooks.organizationId, organizationId),
        ),
      )
      .returning();

    if (!deleted) {
      throw new NotFoundException('Webhook endpoint not found.');
    }

    void this.auditService.log({
      action: 'org.webhook.deleted',
      organizationId,
      entityId: deleted.id,
      entityType: 'org_webhooks',
      previousValue: { url: deleted.url },
    });

    return { message: 'Webhook deleted successfully.' };
  }
}
