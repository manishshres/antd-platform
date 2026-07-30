import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, or, inArray, isNull, count } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuditService } from '../common/services/audit.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { notDeleted } from '../database/db.utils';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AnalyticsService } from '../analytics/analytics.service';

/**
 * The nested menu tree `getMenuByOrg` assembles (categories → items → modifiers → options).
 * It is built from several joined queries rather than one Drizzle relation, so its shape is
 * declared here instead of inferred — previously it was read back as `any[]`, which is where
 * a large share of this file's `no-unsafe-*` errors came from (N9).
 */
interface MenuTreeOption {
  id: string;
  name: string;
  priceAdjustment: number | null;
}

interface MenuTreeModifier {
  name: string;
  isRequired: boolean | null;
  options?: MenuTreeOption[];
}

interface MenuTreeItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  isAvailable: boolean | null;
  modifiers?: MenuTreeModifier[];
}

interface MenuTreeCategory {
  id: string;
  name: string;
  description: string | null;
  items?: MenuTreeItem[];
}

@Injectable()
export class MenusService {
  private readonly logger = new Logger(MenusService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    @InjectQueue('import-queue')
    private readonly importQueue: Queue,
    @InjectQueue('menu-ai-sync-queue')
    private readonly menuAiSyncQueue: Queue,
    private readonly auditService: AuditService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly telnyxService: TelnyxService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
  ) {}

  async getMenu(
    user: CurrentUserPayload,
    pagination: PaginationDto,
    locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    const orgId = await this.billingService.getRequiredOrg(user);
    return this.getMenuByOrg(orgId, pagination, locationId);
  }

  async clearMenuCache(
    user: CurrentUserPayload,
  ): Promise<{ cleared: boolean }> {
    // Scope the clear to the caller's org — never flush every tenant's cache (H7).
    const orgId = await this.billingService.getRequiredOrg(user);
    await this.invalidateMenuCache(orgId);
    return { cleared: true };
  }

  async getMenuByOrg(
    orgId: string,
    pagination: PaginationDto,
    locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { offset = 0, limit = 20 } = pagination;

    // Version-stamped, fully-qualified cache key: org-scoped, includes showDeleted so admin
    // "show deleted" views and customer views never poison each other, and carries a version
    // that invalidation bumps — so we never need a blocking Redis KEYS scan (H7).
    const version = await this.getMenuCacheVersion(orgId);
    const scope = pagination.showDeleted ? 'withDeleted' : 'active';
    const cacheKey = `menu:${orgId}:v${version}:${scope}:${locationId || 'all'}:${offset}:${limit}`;
    const cached =
      await this.cacheManager.get<PaginatedResponseDto<unknown>>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch categories sorted by sortOrder
    const categoriesList = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.organizationId, orgId),
          pagination.showDeleted ? undefined : notDeleted(schema.categories),
          locationId
            ? or(
                isNull(schema.categories.locationId),
                eq(schema.categories.locationId, locationId),
              )
            : isNull(schema.categories.locationId),
        ),
      )
      .orderBy(schema.categories.sortOrder)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.organizationId, orgId),
          pagination.showDeleted ? undefined : notDeleted(schema.categories),
          locationId
            ? or(
                isNull(schema.categories.locationId),
                eq(schema.categories.locationId, locationId),
              )
            : isNull(schema.categories.locationId),
        ),
      );

    // Fetch all items for these categories using optimized inArray
    const categoryIds = categoriesList.map((c) => c.id);
    if (categoryIds.length === 0) {
      const result = {
        data: [],
        total,
        hasMore: offset + limit < total,
      };
      await this.cacheManager.set(cacheKey, result, 3600000);
      return result;
    }

    const itemsList = await this.db
      .select()
      .from(schema.menuItems)
      .where(
        and(
          inArray(schema.menuItems.categoryId, categoryIds),
          pagination.showDeleted ? undefined : notDeleted(schema.menuItems),
          locationId
            ? or(
                isNull(schema.menuItems.locationId),
                eq(schema.menuItems.locationId, locationId),
              )
            : isNull(schema.menuItems.locationId),
        ),
      );

    const itemIds = itemsList.map((item) => item.id);
    // Fetched unconditionally (not gated on itemIds.length) — a category can
    // have modifier groups assigned directly with zero items in it so far,
    // and the frontend's category edit modal needs this to know what's
    // currently attached (see modifiersByCategoryId below).
    const categoryToModifiers = categoryIds.length
      ? await this.db
          .select()
          .from(schema.categoryToModifiers)
          .where(inArray(schema.categoryToModifiers.categoryId, categoryIds))
      : [];
    const itemToModifiers = itemIds.length
      ? await this.db
          .select()
          .from(schema.menuItemToModifiers)
          .where(inArray(schema.menuItemToModifiers.menuItemId, itemIds))
      : [];

    const modifierIds = [
      ...new Set([
        ...itemToModifiers.map((m) => m.modifierId),
        ...categoryToModifiers.map((m) => m.modifierId),
      ]),
    ];

    let modifiersList: (typeof schema.menuModifiers.$inferSelect)[] = [];
    let optionsList: (typeof schema.menuItemModifiers.$inferSelect)[] = [];
    if (modifierIds.length > 0) {
      modifiersList = await this.db
        .select()
        .from(schema.menuModifiers)
        .where(
          and(
            inArray(schema.menuModifiers.id, modifierIds),
            notDeleted(schema.menuModifiers),
            locationId
              ? or(
                  isNull(schema.menuModifiers.locationId),
                  eq(schema.menuModifiers.locationId, locationId),
                )
              : isNull(schema.menuModifiers.locationId),
          ),
        );
      optionsList = await this.db
        .select()
        .from(schema.menuItemModifiers)
        .where(
          and(
            inArray(schema.menuItemModifiers.modifierId, modifierIds),
            notDeleted(schema.menuItemModifiers),
          ),
        );
    }

    const modifiersWithOptions = modifiersList.map((mod) => ({
      ...mod,
      options: optionsList.filter((opt) => opt.modifierId === mod.id),
    }));

    itemsList.forEach((item) => {
      const itemAttachedModIds = itemToModifiers
        .filter((m) => m.menuItemId === item.id)
        .map((m) => m.modifierId);
      const catAttachedModIds = categoryToModifiers
        .filter((m) => m.categoryId === item.categoryId)
        .map((m) => m.modifierId);

      const attachedModifierIds = [
        ...new Set([...itemAttachedModIds, ...catAttachedModIds]),
      ];

      (item as Record<string, unknown>).modifiers = modifiersWithOptions.filter(
        (mod) => attachedModifierIds.includes(mod.id),
      );
    });

    // Group items by category, and — separately — attach each category's OWN
    // modifier assignments. Without this, the category never carries a
    // `.modifiers` array of its own (only items did), so the frontend's Edit
    // Category modal always read `editingCat.modifiers` as undefined: it showed
    // every category as having no modifiers assigned, and its add/remove diff
    // (currentModIds vs newModIds) always saw an empty currentModIds — meaning
    // a modifier could be added but never removed from a category via that UI.
    const data = categoriesList.map((cat) => {
      const attachedModifierIds = categoryToModifiers
        .filter((m) => m.categoryId === cat.id)
        .map((m) => m.modifierId);
      return {
        ...cat,
        items: itemsList.filter((item) => item.categoryId === cat.id),
        modifiers: modifiersWithOptions.filter((mod) =>
          attachedModifierIds.includes(mod.id),
        ),
      };
    });

    const result = {
      data,
      total,
      hasMore: offset + limit < total,
    };

    // Cache for 1 hour (TTL is in milliseconds for cache-manager v5)
    await this.cacheManager.set(cacheKey, result, 3600000);
    return result;
  }

  /** Current cache-version stamp for an org's menu (0 when never invalidated). */
  private async getMenuCacheVersion(orgId: string): Promise<number> {
    const v = await this.cacheManager.get<number>(`menu:${orgId}:ver`);
    return typeof v === 'number' ? v : 0;
  }

  /**
   * Invalidate an org's menu cache by bumping its version stamp — a single O(1) write. Old
   * entries fall out of reach immediately and expire via their TTL. No cross-tenant flush and
   * no blocking KEYS scan on the shared Redis (H7).
   */
  private async invalidateMenuCache(orgId: string) {
    // Version TTL must outlive the data TTL (1h) so entries can't be revived by a reset stamp.
    await this.cacheManager.set(
      `menu:${orgId}:ver`,
      Date.now(),
      7 * 24 * 3600000,
    );
    // Keep the AI voice agent's menu fresh: every content change schedules a debounced re-sync of
    // this org's already-published locations. It's fire-and-forget — a scheduling hiccup must
    // never fail the menu edit itself.
    await this.scheduleMenuAiSync(orgId).catch((err) =>
      this.logger.warn(
        `Failed to schedule AI menu sync for org ${orgId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  /**
   * Debounced trigger for re-publishing the menu to the Telnyx AI agent. Rapid edits collapse into
   * a single sync: each call cancels the pending delayed job (keyed per org) and re-arms the timer,
   * so the embed only runs ~45s after edits stop — embeddings are slow/costly, so we never fire one
   * per keystroke. Skipped entirely when Telnyx isn't configured (e.g. local dev).
   */
  private async scheduleMenuAiSync(orgId: string) {
    if (!this.telnyxService.isConfigured()) return;
    const jobId = `menu-ai-sync:${orgId}`;
    const existing = await this.menuAiSyncQueue.getJob(jobId);
    if (existing) {
      // Can't remove an actively-running job; that run will pick up the latest DB state anyway.
      await existing.remove().catch(() => undefined);
    }
    await this.menuAiSyncQueue.add(
      'sync-menu-ai',
      { orgId },
      {
        jobId,
        delay: 45000,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }

  async createCategory(
    user: CurrentUserPayload,
    name: string,
    locationId?: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const newCats = await this.db
      .insert(schema.categories)
      .values({
        name,
        organizationId: orgId,
        locationId: locationId || null,
        sortOrder: 0,
      })
      .returning();

    this.auditService.fireAndForget({
      action: 'menu.category.create',
      userId: user.id,
      organizationId: orgId,
      entityType: 'category',
      entityId: newCats[0].id,
      newValue: { name },
    });
    await this.invalidateMenuCache(orgId);
    return newCats[0];
  }

  async updateCategory(
    user: CurrentUserPayload,
    id: string,
    dto: { name?: string; isAvailable?: boolean },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    const cat = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.organizationId, orgId),
          notDeleted(schema.categories),
        ),
      )
      .limit(1);

    if (cat.length === 0) {
      throw new NotFoundException('Category not found.');
    }

    const [updated] = await this.db
      .update(schema.categories)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.categories.id, id))
      .returning();

    this.auditService.fireAndForget({
      action: 'menu.category.update',
      userId: user.id,
      organizationId: orgId,
      entityType: 'category',
      entityId: id,
      newValue: updated,
    });
    await this.invalidateMenuCache(orgId);
    return updated;
  }

  async deleteCategory(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // Ensure category belongs to user's organization
    const cat = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.organizationId, orgId),
          notDeleted(schema.categories),
        ),
      )
      .limit(1);

    if (cat.length === 0) {
      throw new NotFoundException('Category not found.');
    }

    // M7: Cascade soft-delete child items in the same transaction to prevent orphaned active items.
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(schema.menuItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.menuItems.categoryId, id),
            isNull(schema.menuItems.deletedAt),
          ),
        );
      await tx
        .update(schema.categories)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.categories.id, id));
    });

    this.auditService.fireAndForget({
      action: 'menu.category.delete',
      userId: user.id,
      organizationId: orgId,
      entityType: 'category',
      entityId: id,
    });
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async createMenuItem(
    user: CurrentUserPayload,
    categoryId: string,
    name: string,
    description: string,
    price: number,
    imageUrl?: string,
    locationId?: string,
    sku?: string,
    options?: {
      isCombo?: boolean;
      taxExempt?: boolean;
      stockQuantity?: number;
      lowStockThreshold?: number;
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // Validate category belongs to organization
    const cat = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, categoryId),
          eq(schema.categories.organizationId, orgId),
          notDeleted(schema.categories),
        ),
      )
      .limit(1);

    if (cat.length === 0) {
      throw new NotFoundException('Category not found.');
    }

    const newItems = await this.db
      .insert(schema.menuItems)
      .values({
        name,
        description,
        price,
        categoryId,
        locationId: locationId || null,
        imageUrl: imageUrl || null,
        sku: sku || null,
        isCombo: options?.isCombo ?? false,
        taxExempt: options?.taxExempt ?? false,
        stockQuantity: options?.stockQuantity ?? null,
        lowStockThreshold: options?.lowStockThreshold ?? null,
        isAvailable: true,
      })
      .returning();

    this.auditService.fireAndForget({
      action: 'menu.item.create',
      userId: user.id,
      organizationId: orgId,
      entityType: 'menu_item',
      entityId: newItems[0].id,
      newValue: {
        name,
        description,
        price,
        categoryId,
        imageUrl,
        sku,
        ...options,
        isAvailable: true,
      },
    });
    await this.invalidateMenuCache(orgId);
    return newItems[0];
  }

  async deleteMenuItem(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);

    const item = await this.db
      .select()
      .from(schema.menuItems)
      .where(and(eq(schema.menuItems.id, id), notDeleted(schema.menuItems)))
      .limit(1);

    if (item.length === 0) {
      throw new NotFoundException('Menu item not found.');
    }

    // Verify category belongs to organization
    const cat = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, item[0].categoryId),
          eq(schema.categories.organizationId, orgId),
          notDeleted(schema.categories),
        ),
      )
      .limit(1);

    if (cat.length === 0) {
      throw new NotFoundException(
        'Menu item does not belong to your organization.',
      );
    }

    await this.db
      .update(schema.menuItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.menuItems.id, id));

    this.auditService.fireAndForget({
      action: 'menu.item.delete',
      userId: user.id,
      organizationId: orgId,
      entityType: 'menu_item',
      entityId: id,
    });
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async importFromWebsite(
    user: CurrentUserPayload,
    url: string,
    dtoOrgId?: string,
    dtoLocationId?: string,
    importMode: 'add_new' | 'sync' | 'replace' = 'sync',
  ) {
    let orgId = user.organizationId;
    let targetLocationId = dtoLocationId;

    if (user.role === 'platform_admin' || user.isPlatformAdmin) {
      if (!dtoOrgId) {
        throw new BadRequestException(
          'Platform admins must specify an orgId to import a menu.',
        );
      }
      orgId = dtoOrgId;
      targetLocationId = dtoLocationId || undefined;
    } else if (user.role === 'manager') {
      if (!user.locationId) {
        throw new ForbiddenException(
          'Manager is not assigned to any location.',
        );
      }
      targetLocationId = user.locationId; // Force manager to their location
    }

    if (!orgId) {
      throw new BadRequestException('Organization ID could not be determined.');
    }

    let finalUrl = url;
    if (!finalUrl) {
      if (!targetLocationId) {
        throw new BadRequestException(
          'URL is required if no location is specified.',
        );
      }
      const loc = await this.db.query.locations.findFirst({
        where: eq(schema.locations.id, targetLocationId),
      });
      if (!loc || !loc.menuImportSource) {
        throw new BadRequestException(
          'No menu sync URL or PDF configured for this location. Please set it in Settings.',
        );
      }
      finalUrl = loc.menuImportSource;
    }

    // Enqueue the website crawl and AI menu extraction task asynchronously
    const job = await this.importQueue.add('import-menu', {
      orgId,
      url: finalUrl,
      locationId: targetLocationId || null,
      importMode,
    });

    // Record the import against the org's monthly website-import allowance so PlanLimitGuard
    // can enforce the limit (usage_events.locationId is NOT NULL, so only record when known).
    if (targetLocationId) {
      void this.analyticsService.recordUsage(
        orgId,
        targetLocationId,
        'website_import',
        1,
        { jobId: job.id },
      );
    }

    return {
      success: true,
      jobId: job.id,
      message: 'Menu import task successfully queued in the background.',
    };
  }

  /**
   * Returns the current status of a BullMQ import job.
   * States: waiting | active | completed | failed | delayed | unknown
   */
  async getImportJobStatus(jobId: string) {
    const job = await this.importQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found.`);
    }

    const state = await job.getState();
    const progress = job.progress;
    const failedReason = job.failedReason ?? null;
    const returnValue = (
      state === 'completed' ? job.returnvalue : null
    ) as unknown;

    return {
      jobId,
      state,
      progress,
      failedReason,
      result: returnValue,
      url: (job.data as { url: string }).url,
      createdAt: new Date(job.timestamp).toISOString(),
      processedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      finishedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
    };
  }

  async createModifierGroup(
    user: CurrentUserPayload,
    name: string,
    locationId?: string,
    isRequired: boolean = false,
    multiSelect: boolean = false,
    maxSelections?: number,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const newGroup = await this.db
      .insert(schema.menuModifiers)
      .values({
        name,
        organizationId: orgId,
        locationId: locationId || null,
        isRequired,
        multiSelect,
        maxSelections: maxSelections ?? null,
      })
      .returning();

    this.auditService.fireAndForget({
      action: 'menu.modifier_group.create',
      userId: user.id,
      organizationId: orgId,
      entityType: 'menu_modifier',
      entityId: newGroup[0].id,
      newValue: newGroup[0],
    });
    await this.invalidateMenuCache(orgId);
    return newGroup[0];
  }

  async createModifierOption(
    user: CurrentUserPayload,
    modifierId: string,
    name: string,
    priceAdjustment: number,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // verify modifier group exists and belongs to org
    const modGroup = await this.db
      .select()
      .from(schema.menuModifiers)
      .where(
        and(
          eq(schema.menuModifiers.id, modifierId),
          eq(schema.menuModifiers.organizationId, orgId),
          notDeleted(schema.menuModifiers),
        ),
      )
      .limit(1);
    if (modGroup.length === 0) {
      throw new NotFoundException('Modifier group not found');
    }

    const newOption = await this.db
      .insert(schema.menuItemModifiers)
      .values({
        modifierId,
        name,
        priceAdjustment,
      })
      .returning();
    await this.invalidateMenuCache(orgId);
    return newOption[0];
  }

  async assignModifierToItem(
    user: CurrentUserPayload,
    menuItemId: string,
    modifierId: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // verify menu item exists and belongs to org (via category)
    const item = await this.db
      .select({
        id: schema.menuItems.id,
        orgId: schema.categories.organizationId,
      })
      .from(schema.menuItems)
      .innerJoin(
        schema.categories,
        eq(schema.menuItems.categoryId, schema.categories.id),
      )
      .where(
        and(eq(schema.menuItems.id, menuItemId), notDeleted(schema.menuItems)),
      )
      .limit(1);

    if (item.length === 0 || item[0].orgId !== orgId) {
      throw new NotFoundException('Menu item not found');
    }

    // verify modifier exists
    const mod = await this.db
      .select()
      .from(schema.menuModifiers)
      .where(
        and(
          eq(schema.menuModifiers.id, modifierId),
          eq(schema.menuModifiers.organizationId, orgId),
          notDeleted(schema.menuModifiers),
        ),
      )
      .limit(1);
    if (mod.length === 0) {
      throw new NotFoundException('Modifier group not found');
    }

    await this.db.insert(schema.menuItemToModifiers).values({
      menuItemId,
      modifierId,
    });
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async removeModifierFromItem(
    user: CurrentUserPayload,
    menuItemId: string,
    modifierId: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    const item = await this.db
      .select({
        id: schema.menuItems.id,
        orgId: schema.categories.organizationId,
      })
      .from(schema.menuItems)
      .innerJoin(
        schema.categories,
        eq(schema.menuItems.categoryId, schema.categories.id),
      )
      .where(
        and(eq(schema.menuItems.id, menuItemId), notDeleted(schema.menuItems)),
      )
      .limit(1);

    if (item.length === 0 || item[0].orgId !== orgId) {
      throw new NotFoundException('Menu item not found');
    }

    await this.db
      .delete(schema.menuItemToModifiers)
      .where(
        and(
          eq(schema.menuItemToModifiers.menuItemId, menuItemId),
          eq(schema.menuItemToModifiers.modifierId, modifierId),
        ),
      );
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async assignModifierToCategory(
    user: CurrentUserPayload,
    categoryId: string,
    modifierId: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // verify category exists and belongs to org
    const cat = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, categoryId),
          eq(schema.categories.organizationId, orgId),
          notDeleted(schema.categories),
        ),
      )
      .limit(1);

    if (cat.length === 0) {
      throw new NotFoundException('Category not found');
    }

    // verify modifier exists
    const mod = await this.db
      .select()
      .from(schema.menuModifiers)
      .where(
        and(
          eq(schema.menuModifiers.id, modifierId),
          eq(schema.menuModifiers.organizationId, orgId),
          notDeleted(schema.menuModifiers),
        ),
      )
      .limit(1);
    if (mod.length === 0) {
      throw new NotFoundException('Modifier group not found');
    }

    await this.db
      .insert(schema.categoryToModifiers)
      .values({
        categoryId,
        modifierId,
      })
      .onConflictDoNothing(); // safe against duplicates

    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async removeModifierFromCategory(
    user: CurrentUserPayload,
    categoryId: string,
    modifierId: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // verify category exists and belongs to org
    const cat = await this.db
      .select()
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, categoryId),
          eq(schema.categories.organizationId, orgId),
        ),
      )
      .limit(1);

    if (cat.length === 0) {
      throw new NotFoundException('Category not found');
    }

    await this.db
      .delete(schema.categoryToModifiers)
      .where(
        and(
          eq(schema.categoryToModifiers.categoryId, categoryId),
          eq(schema.categoryToModifiers.modifierId, modifierId),
        ),
      );
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  // --- NEW METHODS FOR PHASE 10 ---

  async updateMenuItem(
    user: CurrentUserPayload,
    id: string,
    dto: {
      name?: string;
      description?: string;
      price?: number;
      categoryId?: string;
      imageUrl?: string;
      isAvailable?: boolean;
      isFavorite?: boolean;
      sortOrder?: number;
      availabilitySchedule?: unknown;
      sku?: string;
      isCombo?: boolean;
      taxExempt?: boolean;
      stockQuantity?: number;
      lowStockThreshold?: number;
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    // verify ownership
    const item = await this.db
      .select({ orgId: schema.categories.organizationId })
      .from(schema.menuItems)
      .innerJoin(
        schema.categories,
        eq(schema.menuItems.categoryId, schema.categories.id),
      )
      .where(and(eq(schema.menuItems.id, id), notDeleted(schema.menuItems)))
      .limit(1);

    if (item.length === 0 || item[0].orgId !== orgId) {
      throw new NotFoundException('Menu item not found');
    }

    const [updated] = await this.db
      .update(schema.menuItems)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.menuItems.id, id))
      .returning();

    this.auditService.fireAndForget({
      action: 'menu.item.update',
      userId: user.id,
      organizationId: orgId,
      entityType: 'menu_item',
      entityId: id,
      newValue: updated,
    });
    await this.invalidateMenuCache(orgId);
    return updated;
  }

  async restoreCategory(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const [restored] = await this.db
      .update(schema.categories)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.organizationId, orgId),
        ),
      )
      .returning();

    if (!restored) throw new NotFoundException('Category not found');
    await this.invalidateMenuCache(orgId);
    return restored;
  }

  async restoreMenuItem(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    // verify ownership via category
    const item = await this.db
      .select({ orgId: schema.categories.organizationId })
      .from(schema.menuItems)
      .innerJoin(
        schema.categories,
        eq(schema.menuItems.categoryId, schema.categories.id),
      )
      .where(eq(schema.menuItems.id, id))
      .limit(1);

    if (item.length === 0 || item[0].orgId !== orgId)
      throw new NotFoundException('Menu item not found');

    const [restored] = await this.db
      .update(schema.menuItems)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(schema.menuItems.id, id))
      .returning();

    await this.invalidateMenuCache(orgId);
    return restored;
  }

  async reorderCategories(
    user: CurrentUserPayload,
    orders: { id: string; sortOrder: number }[],
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    await this.db.transaction(async (tx) => {
      for (const order of orders) {
        await tx
          .update(schema.categories)
          .set({ sortOrder: order.sortOrder, updatedAt: new Date() })
          .where(
            and(
              eq(schema.categories.id, order.id),
              eq(schema.categories.organizationId, orgId),
            ),
          );
      }
    });
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async reorderMenuItems(
    user: CurrentUserPayload,
    orders: { id: string; sortOrder: number }[],
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    if (orders.length === 0) return { success: true };

    // Tenant isolation: only reorder items belonging to the caller's org (resolved via their
    // category). Verifying up-front rejects cross-tenant IDs instead of silently writing to
    // another restaurant's menu.
    const ids = orders.map((o) => o.id);
    const ownedItems = await this.db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .innerJoin(
        schema.categories,
        eq(schema.menuItems.categoryId, schema.categories.id),
      )
      .where(
        and(
          inArray(schema.menuItems.id, ids),
          eq(schema.categories.organizationId, orgId),
        ),
      );

    if (ownedItems.length !== ids.length) {
      throw new NotFoundException(
        'One or more menu items were not found in your organization.',
      );
    }

    await this.db.transaction(async (tx) => {
      for (const order of orders) {
        await tx
          .update(schema.menuItems)
          .set({ sortOrder: order.sortOrder, updatedAt: new Date() })
          .where(eq(schema.menuItems.id, order.id));
      }
    });
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async getModifierGroups(user: CurrentUserPayload, locationId?: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const groups = await this.db
      .select()
      .from(schema.menuModifiers)
      .where(
        and(
          eq(schema.menuModifiers.organizationId, orgId),
          notDeleted(schema.menuModifiers),
          locationId
            ? or(
                isNull(schema.menuModifiers.locationId),
                eq(schema.menuModifiers.locationId, locationId),
              )
            : isNull(schema.menuModifiers.locationId),
        ),
      );

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);
    const options = await this.db
      .select()
      .from(schema.menuItemModifiers)
      .where(
        and(
          inArray(schema.menuItemModifiers.modifierId, groupIds),
          notDeleted(schema.menuItemModifiers),
        ),
      );

    return groups.map((g) => ({
      ...g,
      options: options.filter((o) => o.modifierId === g.id),
    }));
  }

  async deleteModifierGroup(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const [deleted] = await this.db
      .update(schema.menuModifiers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.menuModifiers.id, id),
          eq(schema.menuModifiers.organizationId, orgId),
        ),
      )
      .returning();
    if (!deleted) throw new NotFoundException('Modifier group not found');
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async deleteModifierOption(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const opt = await this.db
      .select({ orgId: schema.menuModifiers.organizationId })
      .from(schema.menuItemModifiers)
      .innerJoin(
        schema.menuModifiers,
        eq(schema.menuItemModifiers.modifierId, schema.menuModifiers.id),
      )
      .where(
        and(
          eq(schema.menuItemModifiers.id, id),
          notDeleted(schema.menuItemModifiers),
        ),
      )
      .limit(1);
    if (opt.length === 0 || opt[0].orgId !== orgId)
      throw new NotFoundException('Option not found');

    await this.db
      .update(schema.menuItemModifiers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.menuItemModifiers.id, id));

    await this.invalidateMenuCache(orgId);
    return { success: true };
  }
  async syncMenuToAI(
    orgId: string,
    locationId?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.telnyxService.isConfigured()) {
      throw new ServiceUnavailableException(
        'The AI voice agent is not configured for this environment.',
      );
    }

    // Resolve the target location first — its id keys both the storage bucket and the assistant,
    // so we need it before uploading anything.
    const targetLocs = await this.db
      .select({
        id: schema.locations.id,
        telnyxAssistantId: schema.locations.telnyxAssistantId,
        aiSettings: schema.locations.aiSettings,
      })
      .from(schema.locations)
      .where(
        locationId
          ? eq(schema.locations.id, locationId)
          : eq(schema.locations.organizationId, orgId),
      )
      .limit(1);

    if (targetLocs.length === 0) {
      throw new NotFoundException('No location found for organization.');
    }

    const loc = targetLocs[0];

    const pagination: PaginationDto = { offset: 0, limit: 1000 };
    const menuData = await this.getMenuByOrg(orgId, pagination, loc.id);

    // Create a simplified representation of the menu for the AI to understand
    const cleanMenu = {
      organizationId: orgId,
      locationId: loc.id,
      lastUpdated: new Date().toISOString(),
      categories: (menuData.data as MenuTreeCategory[]).map((cat) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        items: (cat.items ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price,
          available: item.isAvailable !== false,
          modifiers: item.modifiers?.map((mod) => ({
            name: mod.name,
            required: mod.isRequired,
            options: (mod.options ?? []).map((opt) => ({
              id: opt.id,
              name: opt.name,
              priceAdjustment: opt.priceAdjustment,
            })),
          })),
        })),
      })),
    };

    const jsonString = JSON.stringify(cleanMenu, null, 2);

    // One bucket per location keeps tenants strictly isolated: an assistant only ever retrieves its
    // own location's menu, and each embed re-processes just this one file (fast + cheap) instead of
    // every tenant's menu in a shared bucket. Sharing a bucket across restaurants would let one
    // assistant retrieve another's items (cross-tenant hallucination), so never reuse a bucket.
    //
    // A location may pin a pre-created bucket via aiSettings.menuBucket (e.g. 'makalu'); this is
    // required while Telnyx Cloud Storage suspension blocks on-the-fly bucket creation. Otherwise
    // fall back to a per-location name (location ids are lowercase UUIDs → DNS-safe).
    const configuredBucket = (
      loc.aiSettings as { menuBucket?: string } | null
    )?.menuBucket?.trim();
    const bucket = configuredBucket || `menu-${loc.id}`;
    const fileName = 'menu.json';

    await this.telnyxService.uploadKnowledgeDocument(
      fileName,
      jsonString,
      bucket,
    );

    // Trigger the Telnyx embedding process for this location's bucket only.
    const embedRes = await this.telnyxService.embedKnowledgeDocuments(bucket);

    // Telnyx may echo the bucket id under a few shapes; fall back to the bucket name (which is what
    // the retrieval tool keys on).
    const bucketId =
      embedRes?.data?.id ||
      embedRes?.data?.bucket_id ||
      embedRes?.bucket_id ||
      bucket;

    // Link the embedded bucket to this location's AI Assistant (create it on first publish).
    const newAssistantId = await this.telnyxService.createOrUpdateMenuAssistant(
      bucketId,
      loc.telnyxAssistantId || undefined,
    );

    await this.db
      .update(schema.locations)
      .set({
        ...(newAssistantId && newAssistantId !== loc.telnyxAssistantId
          ? { telnyxAssistantId: newAssistantId }
          : {}),
        menuLastSyncedAt: new Date(),
      })
      .where(eq(schema.locations.id, loc.id));

    return {
      success: true,
      message:
        'Menu synchronized to Telnyx AI Knowledge Base and linked to Assistant successfully.',
    };
  }

  /**
   * Re-publish the menu for every already-published location in an org (those with an assistant).
   * Called by the debounced auto-sync worker after menu edits. Locations that have never been
   * published are skipped so we don't proactively create Telnyx assistants/buckets — the first
   * publish stays an explicit manual action.
   */
  async syncOrgPublishedLocationsToAI(orgId: string): Promise<number> {
    if (!this.telnyxService.isConfigured()) return 0;
    const locs = await this.db
      .select({
        id: schema.locations.id,
        telnyxAssistantId: schema.locations.telnyxAssistantId,
      })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.organizationId, orgId),
          isNull(schema.locations.deletedAt),
        ),
      );

    let synced = 0;
    for (const l of locs) {
      // Only refresh locations already linked to an assistant (i.e. published at least once).
      if (!l.telnyxAssistantId) continue;
      await this.syncMenuToAI(orgId, l.id);
      synced += 1;
    }
    return synced;
  }
}
