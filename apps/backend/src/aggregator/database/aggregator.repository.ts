import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import * as schema from '../../database/schema';

export interface ExternalOrderInsert {
  organizationId: string;
  locationId: string | null;
  providerId: string;
  integrationAccountId: string | null;
  externalOrderId: string;
  externalStatus?: string | null;
  externalCreatedAt?: Date | null;
  rawPayload: unknown;
}

type ExternalOrderRow = typeof schema.externalOrders.$inferSelect;
type IntegrationAccountRow = typeof schema.integrationAccounts.$inferSelect;
type IntegrationAccountWithProviderRow = IntegrationAccountRow & {
  providerName: string;
};
type OauthSessionRow = typeof schema.integrationOauthSessions.$inferSelect;

/**
 * Org-scoped Drizzle data access for the aggregator. All marketplace persistence
 * (raw external orders, provider lookups, menu mappings, sync jobs, webhook delivery
 * audit) funnels through here so the services stay free of query-builder details and
 * the CLAUDE.md "Drizzle only, no raw SQL" rule holds.
 */
@Injectable()
export class AggregatorRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ── Providers ──────────────────────────────────────────────────────────────

  async findProviderByName(
    name: string,
  ): Promise<{ id: string; isActive: boolean } | null> {
    const [row] = await this.db
      .select({ id: schema.providers.id, isActive: schema.providers.isActive })
      .from(schema.providers)
      .where(eq(schema.providers.name, name))
      .limit(1);
    return row ?? null;
  }

  async findProviderNameById(providerId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: schema.providers.name })
      .from(schema.providers)
      .where(eq(schema.providers.id, providerId))
      .limit(1);
    return row?.name ?? null;
  }

  async getProviderCapabilities(providerId: string) {
    const [row] = await this.db
      .select()
      .from(schema.providerCapabilities)
      .where(eq(schema.providerCapabilities.providerId, providerId))
      .limit(1);
    return row ?? null;
  }

  // ── Integration accounts ─────────────────────────────────────────────────────

  async findIntegrationAccountById(
    id: string,
  ): Promise<IntegrationAccountRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.integrationAccounts)
      .where(eq(schema.integrationAccounts.id, id))
      .limit(1);
    return row ?? null;
  }

  async findIntegrationAccountForProvider(
    providerId: string,
    organizationId: string,
  ): Promise<IntegrationAccountRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.providerId, providerId),
          eq(schema.integrationAccounts.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listIntegrationAccounts(
    organizationId: string,
  ): Promise<IntegrationAccountWithProviderRow[]> {
    const rows = await this.db
      .select({
        account: schema.integrationAccounts,
        providerName: schema.providers.name,
      })
      .from(schema.integrationAccounts)
      .innerJoin(
        schema.providers,
        eq(schema.integrationAccounts.providerId, schema.providers.id),
      )
      .where(eq(schema.integrationAccounts.organizationId, organizationId));
    return rows.map((row) => ({
      ...row.account,
      providerName: row.providerName,
    }));
  }

  /**
   * Resolve an account by its provider-side store id. Uber Eats sends every store's
   * events to one Primary Webhook URL, so this (store id from the webhook body) is the
   * only way to map an inbound event to a tenant. Scoped by provider so the same store
   * id under a different marketplace can't collide.
   */
  async findIntegrationAccountByProviderStoreId(
    providerId: string,
    providerStoreId: string,
  ): Promise<IntegrationAccountRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.providerId, providerId),
          eq(schema.integrationAccounts.providerStoreId, providerStoreId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createIntegrationAccount(values: {
    organizationId: string;
    locationId: string | null;
    providerId: string;
    credentials: unknown;
    providerStoreId: string | null;
    autoAcceptOrders?: boolean;
  }): Promise<IntegrationAccountRow> {
    const [row] = await this.db
      .insert(schema.integrationAccounts)
      .values(values)
      .returning();
    return row;
  }

  /** Update the lifecycle status / online flag of an account (store.provisioned etc.). */
  async setIntegrationAccountStatus(
    id: string,
    values: {
      status?: string;
      isOnline?: boolean;
      autoAcceptOrders?: boolean;
      locationId?: string;
      providerStoreId?: string;
      credentials?: unknown;
    },
  ): Promise<IntegrationAccountRow | null> {
    const [row] = await this.db
      .update(schema.integrationAccounts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.integrationAccounts.id, id))
      .returning();
    return row ?? null;
  }

  /** Disconnect a marketplace: removes the account (and its encrypted credentials). */
  async deleteIntegrationAccount(id: string): Promise<void> {
    await this.db
      .delete(schema.integrationAccounts)
      .where(eq(schema.integrationAccounts.id, id));
  }

  // ── Merchant OAuth onboarding sessions ───────────────────────────────────────

  async createOauthSession(values: {
    organizationId: string;
    userId: string | null;
    providerId: string;
    locationId: string | null;
    state: string;
    expiresAt: Date;
  }): Promise<OauthSessionRow> {
    const [row] = await this.db
      .insert(schema.integrationOauthSessions)
      .values(values)
      .returning();
    return row;
  }

  /**
   * Claim a pending session by its `state` — the callback's only credential. The status
   * flip is part of the WHERE clause, so two concurrent callbacks with the same state
   * can't both succeed: the loser matches no row and gets null (replay protection).
   */
  async claimOauthSessionByState(
    state: string,
  ): Promise<OauthSessionRow | null> {
    const [row] = await this.db
      .update(schema.integrationOauthSessions)
      .set({ status: 'authorized', updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrationOauthSessions.state, state),
          eq(schema.integrationOauthSessions.status, 'pending'),
          gt(schema.integrationOauthSessions.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }

  async findOauthSessionById(id: string): Promise<OauthSessionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.integrationOauthSessions)
      .where(eq(schema.integrationOauthSessions.id, id))
      .limit(1);
    return row ?? null;
  }

  async updateOauthSession(
    id: string,
    values: {
      status?: string;
      accessToken?: unknown;
      accessTokenExpiresAt?: Date | null;
      discoveredStores?: unknown;
      error?: string | null;
    },
  ): Promise<OauthSessionRow | null> {
    const [row] = await this.db
      .update(schema.integrationOauthSessions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.integrationOauthSessions.id, id))
      .returning();
    return row ?? null;
  }

  // ── Order sources ────────────────────────────────────────────────────────────

  async findOrderSourceId(name: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.orderSources.id })
      .from(schema.orderSources)
      .where(eq(schema.orderSources.name, name))
      .limit(1);
    return row?.id ?? null;
  }

  // ── External orders (raw marketplace layer) ──────────────────────────────────

  /**
   * Idempotent insert keyed on (provider_id, external_order_id). Returns the row
   * (freshly created or the pre-existing one) so callers can detect re-deliveries.
   */
  async upsertExternalOrder(
    payload: ExternalOrderInsert,
  ): Promise<{ row: ExternalOrderRow; created: boolean }> {
    const [inserted] = await this.db
      .insert(schema.externalOrders)
      .values({
        organizationId: payload.organizationId,
        locationId: payload.locationId,
        providerId: payload.providerId,
        integrationAccountId: payload.integrationAccountId,
        externalOrderId: payload.externalOrderId,
        externalStatus: payload.externalStatus ?? null,
        externalCreatedAt: payload.externalCreatedAt ?? null,
        rawPayload: payload.rawPayload,
        syncStatus: 'pending',
      })
      .onConflictDoNothing({
        target: [
          schema.externalOrders.providerId,
          schema.externalOrders.externalOrderId,
        ],
      })
      .returning();

    if (inserted) {
      return { row: inserted, created: true };
    }

    const [existing] = await this.db
      .select()
      .from(schema.externalOrders)
      .where(
        and(
          eq(schema.externalOrders.providerId, payload.providerId),
          eq(schema.externalOrders.externalOrderId, payload.externalOrderId),
        ),
      )
      .limit(1);
    return { row: existing, created: false };
  }

  async markExternalOrderImported(
    externalOrderRowId: string,
    internalOrderId: string,
  ): Promise<void> {
    await this.db
      .update(schema.externalOrders)
      .set({
        internalOrderId,
        syncStatus: 'imported',
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.externalOrders.id, externalOrderRowId));
  }

  async markExternalOrderFailed(
    externalOrderRowId: string,
    error: string,
  ): Promise<void> {
    await this.db
      .update(schema.externalOrders)
      .set({
        syncStatus: 'failed',
        error: error.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(schema.externalOrders.id, externalOrderRowId));
  }

  async findExternalOrderByInternalId(
    internalOrderId: string,
  ): Promise<ExternalOrderRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.externalOrders)
      .where(eq(schema.externalOrders.internalOrderId, internalOrderId))
      .limit(1);
    return row ?? null;
  }

  async findExternalOrderByProviderExternalId(
    providerId: string,
    externalOrderId: string,
  ): Promise<ExternalOrderRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.externalOrders)
      .where(
        and(
          eq(schema.externalOrders.providerId, providerId),
          eq(schema.externalOrders.externalOrderId, externalOrderId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // ── Menu provider mappings ───────────────────────────────────────────────────

  /**
   * Reverse-map a batch of provider item ids to Coneeko menu item ids for one
   * integration account. Only 'mapped' rows resolve.
   */
  async resolveMenuItemIds(
    integrationAccountId: string,
    externalItemIds: string[],
  ): Promise<Map<string, string>> {
    if (externalItemIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        externalMenuItemId: schema.menuProviderMappings.externalMenuItemId,
        coneekoMenuItemId: schema.menuProviderMappings.coneekoMenuItemId,
      })
      .from(schema.menuProviderMappings)
      .where(
        and(
          eq(
            schema.menuProviderMappings.integrationAccountId,
            integrationAccountId,
          ),
          inArray(
            schema.menuProviderMappings.externalMenuItemId,
            externalItemIds,
          ),
        ),
      );

    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.externalMenuItemId) {
        map.set(row.externalMenuItemId, row.coneekoMenuItemId);
      }
    }
    return map;
  }

  async listMenuMappings(integrationAccountId: string) {
    return this.db
      .select()
      .from(schema.menuProviderMappings)
      .where(
        eq(
          schema.menuProviderMappings.integrationAccountId,
          integrationAccountId,
        ),
      );
  }

  async upsertMenuMapping(values: {
    providerId: string;
    integrationAccountId: string;
    coneekoMenuItemId: string;
    externalMenuItemId: string | null;
    externalCategoryId: string | null;
    mappingStatus: string;
  }): Promise<void> {
    await this.db
      .insert(schema.menuProviderMappings)
      .values({ ...values, lastSyncedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          schema.menuProviderMappings.integrationAccountId,
          schema.menuProviderMappings.coneekoMenuItemId,
        ],
        set: {
          externalMenuItemId: values.externalMenuItemId,
          externalCategoryId: values.externalCategoryId,
          mappingStatus: values.mappingStatus,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  // ── Integration sync jobs ─────────────────────────────────────────────────────

  async createSyncJob(values: {
    organizationId: string;
    providerId: string;
    integrationAccountId: string | null;
    type: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(schema.integrationSyncJobs)
      .values({ ...values, status: 'running', startedAt: new Date() })
      .returning({ id: schema.integrationSyncJobs.id });
    return row.id;
  }

  async completeSyncJob(id: string, error?: string): Promise<void> {
    await this.db
      .update(schema.integrationSyncJobs)
      .set({
        status: error ? 'failed' : 'completed',
        error: error ? error.slice(0, 1000) : null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationSyncJobs.id, id));
  }

  // ── Webhook delivery audit ───────────────────────────────────────────────────

  async recordWebhookDelivery(values: {
    webhookEventId: string;
    attemptNumber?: number;
    responseCode?: number | null;
    errorMessage?: string | null;
    processedAt?: Date | null;
  }): Promise<void> {
    await this.db.insert(schema.webhookDeliveries).values({
      webhookEventId: values.webhookEventId,
      attemptNumber: values.attemptNumber ?? 1,
      responseCode: values.responseCode ?? null,
      errorMessage: values.errorMessage ?? null,
      processedAt: values.processedAt ?? null,
    });
  }
}
