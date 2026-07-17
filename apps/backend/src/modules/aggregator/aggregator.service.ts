import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import * as schema from '../../database/schema';
import { CredentialEncryptionService } from './core/services/credential-encryption.service';
import {
  ConeekOrderStatus,
  OrderStatusTransitionService,
} from './core/services/order-status-transition.service';
import { ProviderRegistryService } from './core/services/provider-registry.service';
import { AggregatorRepository } from './database/aggregator.repository';
import { MenuSyncService } from './sync/menu-sync.service';
import { OrdersService } from '../../orders/orders.service';
import { CreateIntegrationAccountDto } from './dto/create-integration-account.dto';

/**
 * Internal (JWT-scoped) aggregator operations: manage integration accounts, list
 * marketplace orders, act on an order against its marketplace (accept/cancel), and
 * trigger a menu sync. All methods are org-scoped by the caller's organizationId.
 */
@Injectable()
export class AggregatorService {
  private readonly logger = new Logger(AggregatorService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly repo: AggregatorRepository,
    private readonly registry: ProviderRegistryService,
    private readonly encryption: CredentialEncryptionService,
    private readonly statusTransition: OrderStatusTransitionService,
    private readonly ordersService: OrdersService,
    private readonly menuSync: MenuSyncService,
  ) {}

  // ── Integration accounts ─────────────────────────────────────────────────────

  /** Strip the (encrypted) credentials blob so it never leaves the API boundary. */
  private sanitize(
    account: typeof schema.integrationAccounts.$inferSelect,
  ): Partial<typeof schema.integrationAccounts.$inferSelect> {
    const safe: Partial<typeof schema.integrationAccounts.$inferSelect> = {
      ...account,
    };
    delete safe.credentials;
    return safe;
  }

  async listIntegrationAccounts(orgId: string) {
    const accounts = await this.repo.listIntegrationAccounts(orgId);
    return accounts.map((account) => this.sanitize(account));
  }

  async createIntegrationAccount(
    orgId: string,
    dto: CreateIntegrationAccountDto,
  ) {
    const provider = await this.repo.findProviderByName(dto.providerName);
    if (!provider) {
      throw new BadRequestException(`Unknown provider: ${dto.providerName}`);
    }

    const account = await this.repo.createIntegrationAccount({
      organizationId: orgId,
      locationId: dto.locationId ?? null,
      providerId: provider.id,
      credentials: this.encryption.encryptJson(dto.credentials),
      providerStoreId: dto.providerStoreId ?? null,
    });

    return this.sanitize(account);
  }

  // ── Marketplace orders ────────────────────────────────────────────────────────

  async listMarketplaceOrders(orgId: string, limit = 50) {
    return this.db
      .select({
        id: schema.externalOrders.id,
        provider: schema.providers.name,
        externalOrderId: schema.externalOrders.externalOrderId,
        externalStatus: schema.externalOrders.externalStatus,
        syncStatus: schema.externalOrders.syncStatus,
        internalOrderId: schema.externalOrders.internalOrderId,
        error: schema.externalOrders.error,
        receivedAt: schema.externalOrders.createdAt,
      })
      .from(schema.externalOrders)
      .innerJoin(
        schema.providers,
        eq(schema.externalOrders.providerId, schema.providers.id),
      )
      .where(eq(schema.externalOrders.organizationId, orgId))
      .orderBy(desc(schema.externalOrders.createdAt))
      .limit(Math.min(limit, 200));
  }

  /** Accept a marketplace order on the provider and confirm the native order. */
  async acceptOrder(orgId: string, internalOrderId: string) {
    const { external, provider } = await this.resolveOrder(
      orgId,
      internalOrderId,
    );
    await this.registry
      .getOrderProvider(provider)
      .acceptOrder(external.integrationAccountId!, external.externalOrderId);
    return this.advanceNativeStatus(orgId, internalOrderId, 'confirmed');
  }

  /** Cancel a marketplace order on the provider and cancel the native order. */
  async cancelOrder(orgId: string, internalOrderId: string, reason?: string) {
    const { external, provider } = await this.resolveOrder(
      orgId,
      internalOrderId,
    );
    await this.registry
      .getOrderProvider(provider)
      .cancelOrder(
        external.integrationAccountId!,
        external.externalOrderId,
        reason,
      );
    return this.advanceNativeStatus(orgId, internalOrderId, 'cancelled');
  }

  private async resolveOrder(orgId: string, internalOrderId: string) {
    const external =
      await this.repo.findExternalOrderByInternalId(internalOrderId);
    if (
      !external ||
      external.organizationId !== orgId ||
      !external.integrationAccountId
    ) {
      throw new NotFoundException('Marketplace order not found.');
    }
    const provider = await this.repo.findProviderNameById(external.providerId);
    if (!provider) throw new NotFoundException('Provider not found.');
    return { external, provider };
  }

  private async advanceNativeStatus(
    orgId: string,
    internalOrderId: string,
    target: ConeekOrderStatus,
  ) {
    const [order] = await this.db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, internalOrderId),
          eq(schema.orders.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!order) throw new NotFoundException('Order not found.');

    const current = order.status as ConeekOrderStatus;
    if (current === target) {
      return this.ordersService.getOrderByIdForOrg(orgId, internalOrderId);
    }
    // Surfaces a clear error rather than silently no-oping an illegal transition.
    this.statusTransition.validateTransition(current, target);
    return this.ordersService.updateStatusForAggregator(
      orgId,
      internalOrderId,
      target,
    );
  }

  // ── Menu sync ─────────────────────────────────────────────────────────────────

  async syncMenu(orgId: string, integrationAccountId: string) {
    return this.menuSync.syncAccountMenu(orgId, integrationAccountId);
  }
}
