import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { DRIZZLE } from '../../../database/database.module';
import * as schema from '../../../database/schema';
import { ProviderRegistryService } from '../core/services/provider-registry.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import {
  NormalizedMenu,
  NormalizedMenuCategory,
  NormalizedMenuItem,
  NormalizedModifierGroup,
} from '../core/models/aggregator.models';

/**
 * Pushes Coneeko's menu (the source of truth) outward to a marketplace via its adapter.
 * Builds a NormalizedMenu from the menu tables, records a menu_provider_mapping per item
 * (we publish Coneeko ids as the provider item ids so inbound orders reverse-map 1:1),
 * and tracks the whole run as an integration_sync_job.
 */
@Injectable()
export class MenuSyncService {
  private readonly logger = new Logger(MenuSyncService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly registry: ProviderRegistryService,
    private readonly repo: AggregatorRepository,
  ) {}

  /**
   * Sync one integration account's menu to its provider. `organizationId` is enforced
   * so a tenant can only sync its own account.
   */
  async syncAccountMenu(organizationId: string, integrationAccountId: string) {
    const account =
      await this.repo.findIntegrationAccountById(integrationAccountId);
    if (!account || account.organizationId !== organizationId) {
      throw new NotFoundException('Integration account not found.');
    }

    const provider = await this.getProviderName(account.providerId);
    const menuProvider = this.registry.getMenuProvider(provider);

    const jobId = await this.repo.createSyncJob({
      organizationId,
      providerId: account.providerId,
      integrationAccountId,
      type: 'MENU_SYNC',
    });

    try {
      const menu = await this.buildNormalizedMenu(
        organizationId,
        account.locationId,
      );

      // Record mappings up front (Coneeko id == provider item id) so a subsequent
      // inbound order line item resolves even before the first order arrives.
      for (const category of menu.categories) {
        for (const item of category.items) {
          await this.repo.upsertMenuMapping({
            providerId: account.providerId,
            integrationAccountId,
            coneekoMenuItemId: item.internalItemId,
            externalMenuItemId: item.internalItemId,
            externalCategoryId: category.internalCategoryId,
            mappingStatus: 'mapped',
          });
        }
      }

      await menuProvider.syncMenu(integrationAccountId, menu);
      await this.repo.completeSyncJob(jobId);

      const itemCount = menu.categories.reduce(
        (sum, c) => sum + c.items.length,
        0,
      );
      this.logger.log(
        `Menu synced to ${provider} for account ${integrationAccountId}: ${menu.categories.length} categories, ${itemCount} items.`,
      );
      return { jobId, categories: menu.categories.length, items: itemCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.completeSyncJob(jobId, message);
      throw err;
    }
  }

  private async getProviderName(providerId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: schema.providers.name })
      .from(schema.providers)
      .where(eq(schema.providers.id, providerId))
      .limit(1);
    if (!row) throw new NotFoundException('Provider not found.');
    return row.name;
  }

  /**
   * Build a NormalizedMenu from Coneeko's menu tables for an org (+ optional location).
   * Includes only available, non-deleted rows — the marketplace should never advertise
   * a hidden item.
   */
  private async buildNormalizedMenu(
    orgId: string,
    locationId: string | null,
  ): Promise<NormalizedMenu> {
    // Location scoping: an org-wide row (locationId null) applies everywhere; a
    // location-specific row applies only to its location.
    const categoryLocation = locationId
      ? or(
          isNull(schema.categories.locationId),
          eq(schema.categories.locationId, locationId),
        )
      : isNull(schema.categories.locationId);
    const itemLocation = locationId
      ? or(
          isNull(schema.menuItems.locationId),
          eq(schema.menuItems.locationId, locationId),
        )
      : isNull(schema.menuItems.locationId);

    const categories = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.organizationId, orgId),
          eq(schema.categories.isAvailable, true),
          isNull(schema.categories.deletedAt),
          categoryLocation,
        ),
      )
      .orderBy(schema.categories.sortOrder);

    const categoryIds = categories.map((c) => c.id);
    if (categoryIds.length === 0) return { categories: [] };

    const items = await this.db
      .select()
      .from(schema.menuItems)
      .where(
        and(
          inArray(schema.menuItems.categoryId, categoryIds),
          eq(schema.menuItems.isAvailable, true),
          isNull(schema.menuItems.deletedAt),
          itemLocation,
        ),
      )
      .orderBy(schema.menuItems.sortOrder);

    const itemIds = items.map((i) => i.id);
    const modifierGroupsByItem = await this.loadModifierGroups(itemIds);

    const normalizedCategories: NormalizedMenuCategory[] = categories.map(
      (cat) => ({
        internalCategoryId: cat.id,
        name: cat.name,
        sortOrder: cat.sortOrder,
        items: items
          .filter((i) => i.categoryId === cat.id)
          .map((item): NormalizedMenuItem => ({
            internalItemId: item.id,
            name: item.name,
            description: item.description ?? undefined,
            price: item.price,
            imageUrl: item.imageUrl ?? undefined,
            sortOrder: item.sortOrder,
            modifierGroups: modifierGroupsByItem.get(item.id) ?? [],
          })),
      }),
    );

    return { categories: normalizedCategories };
  }

  private async loadModifierGroups(
    itemIds: string[],
  ): Promise<Map<string, NormalizedModifierGroup[]>> {
    const byItem = new Map<string, NormalizedModifierGroup[]>();
    if (itemIds.length === 0) return byItem;

    const junction = await this.db
      .select()
      .from(schema.menuItemToModifiers)
      .where(inArray(schema.menuItemToModifiers.menuItemId, itemIds));
    if (junction.length === 0) return byItem;

    const modifierIds = [...new Set(junction.map((j) => j.modifierId))];
    const [groups, options] = await Promise.all([
      this.db
        .select()
        .from(schema.menuModifiers)
        .where(
          and(
            inArray(schema.menuModifiers.id, modifierIds),
            isNull(schema.menuModifiers.deletedAt),
          ),
        ),
      this.db
        .select()
        .from(schema.menuItemModifiers)
        .where(
          and(
            inArray(schema.menuItemModifiers.modifierId, modifierIds),
            isNull(schema.menuItemModifiers.deletedAt),
          ),
        ),
    ]);

    const groupById = new Map(groups.map((g) => [g.id, g]));

    for (const link of junction) {
      const group = groupById.get(link.modifierId);
      if (!group) continue;
      const normalizedGroup: NormalizedModifierGroup = {
        internalModifierGroupId: group.id,
        name: group.name,
        isRequired: group.isRequired,
        multiSelect: group.multiSelect,
        maxSelections: group.maxSelections ?? undefined,
        modifiers: options
          .filter((o) => o.modifierId === group.id)
          .map((o) => ({
            internalModifierId: o.id,
            name: o.name,
            priceAdjustment: o.priceAdjustment,
          })),
      };
      const list = byItem.get(link.menuItemId) ?? [];
      list.push(normalizedGroup);
      byItem.set(link.menuItemId, list);
    }

    return byItem;
  }
}
