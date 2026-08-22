import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Job } from 'bullmq';
import { CrawlerService } from '../crawler.service';
import { AiExtractorService } from '../ai-extractor.service';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq, inArray } from 'drizzle-orm';
// `pdf-parse` is CommonJS with no bundled types; declare the one call we make rather than
// pulling it in via `require`, which defeats type-checking entirely (N9).
import pdfParseImport from 'pdf-parse';
import { SHARED_WORKER_OPTIONS } from '../../queues/queues.module';

const pdfParse = pdfParseImport as unknown as (
  data: Buffer,
) => Promise<{ text: string }>;

interface ImportJobData {
  orgId: string;
  url: string;
  locationId: string | null;
  importMode?: 'add_new' | 'sync' | 'replace';
}

@Processor('import-queue', SHARED_WORKER_OPTIONS)
export class ImportQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportQueueProcessor.name);

  constructor(
    private readonly crawlerService: CrawlerService,
    private readonly aiExtractorService: AiExtractorService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {
    super();
  }

  async process(job: Job<ImportJobData, any, string>): Promise<any> {
    const { orgId, url, locationId, importMode = 'sync' } = job.data;
    this.logger.log(
      `Processing website menu import for organization ${orgId} from URL: ${url} (Mode: ${importMode})`,
    );

    try {
      let text = '';

      // Basic check if it's a direct PDF URL
      if (url.includes('.pdf') || url.includes('/pdf-')) {
        this.logger.log(`URL seems to be a PDF. Fetching and parsing...`);
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(`Failed to fetch PDF from URL: ${res.statusText}`);
        const arrayBuffer = await res.arrayBuffer();
        const pdfData = await pdfParse(Buffer.from(arrayBuffer));
        text = pdfData.text;
      } else {
        // 1. Crawl website
        text = await this.crawlerService.crawl(url);
      }

      if (!text || text.trim().length === 0) {
        throw new Error('Content retrieval returned empty text.');
      }

      // 2. AI Extract
      const menuData = await this.aiExtractorService.extract(text);
      if (
        !menuData ||
        !menuData.categories ||
        menuData.categories.length === 0
      ) {
        throw new Error('AI extraction returned no menu categories.');
      }

      // 3. Database inserts in a transaction for atomicity
      await this.db.transaction(async (tx) => {
        // Handle 'replace' mode — delete in FK dependency order (children first)
        if (importMode === 'replace') {
          if (locationId) {
            // Get IDs to delete child records first
            const locItemIds = (
              await tx
                .select({ id: schema.menuItems.id })
                .from(schema.menuItems)
                .where(eq(schema.menuItems.locationId, locationId))
            ).map((r) => r.id);
            const locModIds = (
              await tx
                .select({ id: schema.menuModifiers.id })
                .from(schema.menuModifiers)
                .where(eq(schema.menuModifiers.locationId, locationId))
            ).map((r) => r.id);

            if (locItemIds.length > 0) {
              await tx
                .delete(schema.menuItemToModifiers)
                .where(
                  inArray(schema.menuItemToModifiers.menuItemId, locItemIds),
                );
            }
            if (locModIds.length > 0) {
              await tx
                .delete(schema.menuItemModifiers)
                .where(inArray(schema.menuItemModifiers.modifierId, locModIds));
            }
            await tx
              .delete(schema.menuItems)
              .where(eq(schema.menuItems.locationId, locationId));
            await tx
              .delete(schema.menuModifiers)
              .where(eq(schema.menuModifiers.locationId, locationId));
          } else {
            // Org-wide replace — get all item & modifier IDs for this org
            const orgCatIds = (
              await tx
                .select({ id: schema.categories.id })
                .from(schema.categories)
                .where(eq(schema.categories.organizationId, orgId))
            ).map((r) => r.id);
            const orgItemIds =
              orgCatIds.length > 0
                ? (
                    await tx
                      .select({ id: schema.menuItems.id })
                      .from(schema.menuItems)
                      .where(inArray(schema.menuItems.categoryId, orgCatIds))
                  ).map((r) => r.id)
                : [];
            const orgModIds = (
              await tx
                .select({ id: schema.menuModifiers.id })
                .from(schema.menuModifiers)
                .where(eq(schema.menuModifiers.organizationId, orgId))
            ).map((r) => r.id);

            if (orgItemIds.length > 0) {
              await tx
                .delete(schema.menuItemToModifiers)
                .where(
                  inArray(schema.menuItemToModifiers.menuItemId, orgItemIds),
                );
            }
            if (orgModIds.length > 0) {
              await tx
                .delete(schema.menuItemModifiers)
                .where(inArray(schema.menuItemModifiers.modifierId, orgModIds));
            }
            if (orgItemIds.length > 0) {
              await tx
                .delete(schema.menuItems)
                .where(inArray(schema.menuItems.id, orgItemIds));
            }
            await tx
              .delete(schema.menuModifiers)
              .where(eq(schema.menuModifiers.organizationId, orgId));
            await tx
              .delete(schema.categories)
              .where(eq(schema.categories.organizationId, orgId));
          }
        }

        // Cache existing categories and items
        const existingCats = await tx
          .select()
          .from(schema.categories)
          .where(eq(schema.categories.organizationId, orgId));
        const catMap = new Map(
          existingCats.map((c) => [c.name.toLowerCase(), c.id]),
        );

        // Tenant isolation: for org-level imports (no locationId) scope existing items to THIS
        // org's categories — never select all menu items globally, or name-matching and the
        // sync-disable below would touch other tenants' menus.
        const orgCatIds = existingCats.map((c) => c.id);
        const existingItems = locationId
          ? await tx
              .select()
              .from(schema.menuItems)
              .where(eq(schema.menuItems.locationId, locationId))
          : orgCatIds.length > 0
            ? await tx
                .select()
                .from(schema.menuItems)
                .where(inArray(schema.menuItems.categoryId, orgCatIds))
            : [];
        const itemMap = new Map(
          existingItems.map((i) => [i.name.toLowerCase(), i]),
        );

        const processedItemIds = new Set<string>();

        for (const cat of menuData.categories) {
          if (cat.items.length === 0) continue;

          let categoryId = catMap.get(cat.name.toLowerCase());
          if (!categoryId) {
            const [newCat] = await tx
              .insert(schema.categories)
              .values({
                name: cat.name,
                organizationId: orgId,
                sortOrder: 0,
              })
              .returning();
            categoryId = newCat.id;
            catMap.set(cat.name.toLowerCase(), categoryId);
          }

          for (let i = 0; i < cat.items.length; i++) {
            const item = cat.items[i];
            const existingItem = itemMap.get(item.name.toLowerCase());
            let itemId = null;

            if (existingItem) {
              if (importMode === 'add_new') continue;

              const [updated] = await tx
                .update(schema.menuItems)
                .set({
                  price: item.price,
                  description: item.description || '',
                  categoryId: categoryId,
                })
                .where(eq(schema.menuItems.id, existingItem.id))
                .returning();
              itemId = updated.id;
            } else {
              const [insertedItem] = await tx
                .insert(schema.menuItems)
                .values({
                  categoryId: categoryId,
                  locationId: locationId || null,
                  name: item.name,
                  description: item.description || '',
                  price: item.price,
                  isAvailable: true,
                  sortOrder: i,
                })
                .returning();
              itemId = insertedItem.id;
            }

            if (itemId) {
              processedItemIds.add(itemId);
            }

            if (
              item.modifiers &&
              item.modifiers.length > 0 &&
              importMode !== 'add_new'
            ) {
              if (existingItem) {
                await tx
                  .delete(schema.menuItemToModifiers)
                  .where(eq(schema.menuItemToModifiers.menuItemId, itemId));
              }

              for (const modGroup of item.modifiers) {
                const [insertedGroup] = await tx
                  .insert(schema.menuModifiers)
                  .values({
                    organizationId: orgId,
                    locationId: locationId || null,
                    name: modGroup.name,
                    isRequired: modGroup.isRequired,
                  })
                  .returning();

                await tx.insert(schema.menuItemToModifiers).values({
                  menuItemId: itemId,
                  modifierId: insertedGroup.id,
                });

                if (modGroup.options && modGroup.options.length > 0) {
                  const optionsToInsert = modGroup.options.map((opt) => ({
                    modifierId: insertedGroup.id,
                    name: opt.name,
                    priceAdjustment: opt.priceAdjustment,
                  }));
                  await tx
                    .insert(schema.menuItemModifiers)
                    .values(optionsToInsert);
                }
              }
            }
          }
        }

        if (importMode === 'sync') {
          const itemsToDisable = Array.from(itemMap.values())
            .filter((item) => !processedItemIds.has(item.id))
            .map((item) => item.id);

          if (itemsToDisable.length > 0) {
            await tx
              .update(schema.menuItems)
              .set({ isAvailable: false })
              .where(inArray(schema.menuItems.id, itemsToDisable));
          }
        }
      });

      // Clear the cache so new items show up in the UI immediately
      await this.cacheManager.clear();

      this.logger.log(
        `Successfully imported menu for organization ${orgId} from URL: ${url}`,
      );
      return { success: true, categoriesCount: menuData.categories.length };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Failed to import menu from URL "${url}": ${message}`,
        stack,
      );
      throw err;
    }
  }
}
