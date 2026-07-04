import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../common/services/audit.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    private readonly auditService: AuditService,
  ) {}

  async generateApiKey(
    userOrId: string | { id: string; organizationId?: string | null },
    name: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(userOrId);

    // We need the userId for audit logging
    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;

    const rawKey = crypto.randomBytes(32).toString('hex');
    const apiKey = `coai_${rawKey}`;
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const newKey = await this.db
      .insert(schema.apiKeys)
      .values({
        organizationId: orgId,
        name,
        keyHash,
      })
      .returning();

    void this.auditService.log({
      action: 'api_key.create',
      userId,
      organizationId: orgId,
      entityType: 'api_key',
      entityId: newKey[0].id,
      newValue: { name },
    });

    // Also sync this Developer API key to Telnyx assistants so they use it to authenticate webhooks
    await this.billingService.syncApiKeyToAssistants(orgId, apiKey);

    return {
      id: newKey[0].id,
      name: newKey[0].name,
      createdAt: newKey[0].createdAt,
      apiKey, // Returned only once!
    };
  }

  async getApiKeys(
    userOrId: string | { id: string; organizationId?: string | null },
  ) {
    const orgId = await this.billingService.getRequiredOrg(userOrId);

    const keys = await this.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        expiresAt: schema.apiKeys.expiresAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.organizationId, orgId));

    return { data: keys };
  }

  async revokeApiKey(
    userOrId: string | { id: string; organizationId?: string | null },
    keyId: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(userOrId);

    // We need the userId for audit logging
    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;

    const key = await this.db
      .select()
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.id, keyId),
          eq(schema.apiKeys.organizationId, orgId),
        ),
      )
      .limit(1);

    if (key.length === 0) {
      throw new NotFoundException(
        'API Key not found or does not belong to this organization.',
      );
    }

    await this.db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, keyId));

    void this.auditService.log({
      action: 'api_key.revoke',
      userId,
      organizationId: orgId,
      entityType: 'api_key',
      entityId: keyId,
    });

    return { success: true };
  }
}
