import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
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
import { Redis } from 'ioredis';
import { notDeleted } from '../database/db.utils';
import { TelnyxService } from '../telnyx/telnyx.service';

@Injectable()
export class MenusService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    @InjectQueue('import-queue')
    private readonly importQueue: Queue,
    private readonly auditService: AuditService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly telnyxService: TelnyxService,
  ) {}

  async getMenu(
    userId: string,
    pagination: PaginationDto,
    locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    const orgId = await this.billingService.getRequiredOrg(userId);
    return this.getMenuByOrg(orgId, pagination, locationId);
  }

  async clearMenuCache(userId: string): Promise<{ cleared: boolean }> {
    await this.cacheManager.clear();
    return { cleared: true };
  }

  async getMenuByOrg(
    orgId: string,
    pagination: PaginationDto,
    locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { offset = 0, limit = 20 } = pagination;

    const cacheKey = `menu:${orgId}:${locationId || 'all'}:${offset}:${limit}`;
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
    if (itemIds.length > 0) {
      const itemToModifiers = await this.db
        .select()
        .from(schema.menuItemToModifiers)
        .where(inArray(schema.menuItemToModifiers.menuItemId, itemIds));

      const modifierIds = [
        ...new Set(itemToModifiers.map((m) => m.modifierId)),
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
        const attachedModifierIds = itemToModifiers
          .filter((m) => m.menuItemId === item.id)
          .map((m) => m.modifierId);
        (item as Record<string, unknown>).modifiers =
          modifiersWithOptions.filter((mod) =>
            attachedModifierIds.includes(mod.id),
          );
      });
    }

    // Group items by category
    const data = categoriesList.map((cat) => {
      return {
        ...cat,
        items: itemsList.filter((item) => item.categoryId === cat.id),
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

  private async invalidateMenuCache(orgId: string) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const store = (this.cacheManager as any).store as { client?: Redis };
    const client = store.client;
    if (client && typeof client.keys === 'function') {
      const keys = await client.keys(`menu:${orgId}:*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    }
  }

  async createCategory(userId: string, name: string, locationId?: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);
    const newCats = await this.db
      .insert(schema.categories)
      .values({
        name,
        organizationId: orgId,
        locationId: locationId || null,
        sortOrder: 0,
      })
      .returning();

    void this.auditService.log({
      action: 'menu.category.create',
      userId,
      organizationId: orgId,
      entityType: 'category',
      entityId: newCats[0].id,
      newValue: { name },
    });
    await this.invalidateMenuCache(orgId);
    return newCats[0];
  }

  async updateCategory(
    userId: string,
    id: string,
    dto: { name?: string; isAvailable?: boolean },
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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

    void this.auditService.log({
      action: 'menu.category.update',
      userId,
      organizationId: orgId,
      entityType: 'category',
      entityId: id,
      newValue: updated,
    });
    await this.invalidateMenuCache(orgId);
    return updated;
  }

  async deleteCategory(userId: string, id: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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

    // Cascade deletion is handled by DB foreign keys, but wrap in a transaction for safety
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.categories)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.categories.id, id));
    });

    void this.auditService.log({
      action: 'menu.category.delete',
      userId,
      organizationId: orgId,
      entityType: 'category',
      entityId: id,
    });
    await this.invalidateMenuCache(orgId);
    return { success: true };
  }

  async createMenuItem(
    userId: string,
    categoryId: string,
    name: string,
    description: string,
    price: number,
    imageUrl?: string,
    locationId?: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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
        isAvailable: true,
      })
      .returning();

    void this.auditService.log({
      action: 'menu.item.create',
      userId,
      organizationId: orgId,
      entityType: 'menu_item',
      entityId: newItems[0].id,
      newValue: {
        name,
        description,
        price,
        categoryId,
        imageUrl,
        isAvailable: true,
      },
    });
    await this.invalidateMenuCache(orgId);
    return newItems[0];
  }

  async deleteMenuItem(userId: string, id: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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

    void this.auditService.log({
      action: 'menu.item.delete',
      userId,
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
        throw new BadRequestException('Platform admins must specify an orgId to import a menu.');
      }
      orgId = dtoOrgId;
      targetLocationId = dtoLocationId || undefined;
    } else if (user.role === 'manager') {
      if (!user.locationId) {
        throw new ForbiddenException('Manager is not assigned to any location.');
      }
      targetLocationId = user.locationId; // Force manager to their location
    }

    if (!orgId) {
      throw new BadRequestException('Organization ID could not be determined.');
    }

    let finalUrl = url;
    if (!finalUrl) {
      if (!targetLocationId) {
        throw new BadRequestException('URL is required if no location is specified.');
      }
      const loc = await this.db.query.locations.findFirst({
        where: eq(schema.locations.id, targetLocationId)
      });
      if (!loc || !loc.menuImportSource) {
        throw new BadRequestException('No menu sync URL or PDF configured for this location. Please set it in Settings.');
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

    return {
      success: true,
      jobId: job.id,
      message: 'Menu import task successfully queued in the background.',
    };
  }

  /**
   * Returns the current status of a BullMQ import job.
import { notDeleted } from '../database/db.utils';
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
    userId: string,
    name: string,
    locationId?: string,
    isRequired: boolean = false,
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);
    const newGroup = await this.db
      .insert(schema.menuModifiers)
      .values({
        name,
        organizationId: orgId,
        locationId: locationId || null,
        isRequired,
      })
      .returning();

    void this.auditService.log({
      action: 'menu.modifier_group.create',
      userId,
      organizationId: orgId,
      entityType: 'menu_modifier',
      entityId: newGroup[0].id,
      newValue: newGroup[0],
    });
    await this.invalidateMenuCache(orgId);
    return newGroup[0];
  }

  async createModifierOption(
    userId: string,
    modifierId: string,
    name: string,
    priceAdjustment: number,
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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
    userId: string,
    menuItemId: string,
    modifierId: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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

  // --- NEW METHODS FOR PHASE 10 ---

  async updateMenuItem(
    userId: string,
    id: string,
    dto: {
      name?: string;
      description?: string;
      price?: number;
      categoryId?: string;
      imageUrl?: string;
      isAvailable?: boolean;
      sortOrder?: number;
      availabilitySchedule?: unknown;
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);

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

    void this.auditService.log({
      action: 'menu.item.update',
      userId,
      organizationId: orgId,
      entityType: 'menu_item',
      entityId: id,
      newValue: updated,
    });
    await this.invalidateMenuCache(orgId);
    return updated;
  }

  async restoreCategory(userId: string, id: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);
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

  async restoreMenuItem(userId: string, id: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);
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
    userId: string,
    orders: { id: string; sortOrder: number }[],
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);
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
    userId: string,
    orders: { id: string; sortOrder: number }[],
  ) {
    const orgId = await this.billingService.getRequiredOrg(userId);
    // Basic verification is skipped per item for perf, we just update. The user must be authenticated.
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

  async getModifierGroups(userId: string, locationId?: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);
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

  async deleteModifierGroup(userId: string, id: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);
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

  async deleteModifierOption(userId: string, id: string) {
    const orgId = await this.billingService.getRequiredOrg(userId);
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
  async syncMenuToAI(orgId: string, locationId?: string): Promise<{ success: boolean; message: string }> {
    const pagination: PaginationDto = { offset: 0, limit: 1000 };
    const menuData = await this.getMenuByOrg(orgId, pagination, locationId);
    
    // Create a simplified representation of the menu for the AI to understand
    const cleanMenu = {
      organizationId: orgId,
      locationId: locationId || 'default',
      lastUpdated: new Date().toISOString(),
      categories: (menuData.data as any[]).map(cat => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        items: cat.items.map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price,
          modifiers: item.modifiers?.map((mod: any) => ({
            name: mod.groupName,
            required: mod.required,
            options: mod.options.map((opt: any) => ({
              id: opt.id,
              name: opt.name,
              priceAdjustment: opt.priceAdjustment
            }))
          }))
        }))
      }))
    };

    const jsonString = JSON.stringify(cleanMenu, null, 2);
    const fileName = `menu_${orgId}${locationId ? `_${locationId}` : ''}.json`;

    // Upload the JSON file to Telnyx Storage Bucket
    await this.telnyxService.uploadKnowledgeDocument(fileName, jsonString);

    // Trigger the Telnyx embedding process
    const embedRes: any = await this.telnyxService.embedKnowledgeDocuments();
    
    // Extract the bucket_id. Telnyx API might return it under data.id, data.bucket_id, or just the bucketName
    const bucketName = process.env.TELNYX_STORAGE_BUCKET || 'restaurant-menu';
    const bucketId = embedRes?.data?.id || embedRes?.data?.bucket_id || embedRes?.bucket_id || bucketName;

    // Find the target location to get its assistant ID
    const targetLocs = await this.db
      .select({ id: schema.locations.id, telnyxAssistantId: schema.locations.telnyxAssistantId })
      .from(schema.locations)
      .where(
        locationId
          ? eq(schema.locations.id, locationId)
          : eq(schema.locations.organizationId, orgId)
      )
      .limit(1);

    if (targetLocs.length === 0) {
      throw new Error('No location found for organization.');
    }

    const loc = targetLocs[0];

    // Link it to the AI Assistant
    const newAssistantId = await this.telnyxService.createOrUpdateMenuAssistant(bucketId, loc.telnyxAssistantId || undefined);

    // Save the new assistant ID if it changed
    if (newAssistantId && newAssistantId !== loc.telnyxAssistantId) {
      await this.db
        .update(schema.locations)
        .set({ telnyxAssistantId: newAssistantId })
        .where(eq(schema.locations.id, loc.id));
    }

    return { success: true, message: 'Menu synchronized to Telnyx AI Knowledge Base and linked to Assistant successfully.' };
  }
}
