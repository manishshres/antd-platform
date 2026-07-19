import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, inArray, isNull, sql, gte } from 'drizzle-orm';
import {
  startOfBusinessDay,
  DEFAULT_TIMEZONE,
} from '../common/time/business-day';

export interface ResolvedCartItem {
  menuItemId: string;
  quantity: number;
  price: number;
  modifiers:
    | {
        optionId: string;
        modifier: string;
        option: string;
        priceAdjustment: number;
      }[]
    | null;
  notes: string | null;
  course: number | null;
}

@Injectable()
export class OrderPricingService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Price a POS cart server-side: base item prices and modifier option adjustments come from
   * the DB (org-scoped, available, non-deleted), option→item attachment is validated, and
   * required modifier groups are enforced. Snapshots include the optionId so an order can be
   * re-opened and edited in the register later.
   */
  async priceCartItems(
    orgId: string,
    items: {
      menuItemId: string;
      quantity: number;
      optionIds?: string[];
      notes?: string;
      course?: number;
    }[],
  ): Promise<{ resolvedItems: ResolvedCartItem[]; subtotal: number }> {
    const itemIds = [...new Set(items.map((i) => i.menuItemId))];
    const dbItems = await this.db
      .select({
        id: schema.menuItems.id,
        price: schema.menuItems.price,
        locationId: schema.menuItems.locationId,
      })
      .from(schema.menuItems)
      .innerJoin(
        schema.categories,
        eq(schema.menuItems.categoryId, schema.categories.id),
      )
      .where(
        and(
          inArray(schema.menuItems.id, itemIds),
          eq(schema.categories.organizationId, orgId),
          isNull(schema.menuItems.deletedAt),
          eq(schema.menuItems.isAvailable, true),
        ),
      );
    const dbItemsMap = new Map(dbItems.map((i) => [i.id, i]));

    // Resolve every selected modifier option in one batch, org-scoped through its group.
    const allOptionIds = [...new Set(items.flatMap((i) => i.optionIds ?? []))];
    const optionRows = allOptionIds.length
      ? await this.db
          .select({
            id: schema.menuItemModifiers.id,
            name: schema.menuItemModifiers.name,
            priceAdjustment: schema.menuItemModifiers.priceAdjustment,
            modifierId: schema.menuItemModifiers.modifierId,
            modifierName: schema.menuModifiers.name,
          })
          .from(schema.menuItemModifiers)
          .innerJoin(
            schema.menuModifiers,
            eq(schema.menuItemModifiers.modifierId, schema.menuModifiers.id),
          )
          .where(
            and(
              inArray(schema.menuItemModifiers.id, allOptionIds),
              eq(schema.menuModifiers.organizationId, orgId),
              isNull(schema.menuItemModifiers.deletedAt),
              isNull(schema.menuModifiers.deletedAt),
            ),
          )
      : [];
    const optionMap = new Map(optionRows.map((o) => [o.id, o]));

    // Which modifier groups are attached to which items (validates option→item ownership and
    // lets us enforce required groups).
    const attachRows = await this.db
      .select({
        menuItemId: schema.menuItemToModifiers.menuItemId,
        modifierId: schema.menuItemToModifiers.modifierId,
        isRequired: schema.menuModifiers.isRequired,
        multiSelect: schema.menuModifiers.multiSelect,
        maxSelections: schema.menuModifiers.maxSelections,
      })
      .from(schema.menuItemToModifiers)
      .innerJoin(
        schema.menuModifiers,
        eq(schema.menuItemToModifiers.modifierId, schema.menuModifiers.id),
      )
      .where(
        and(
          inArray(schema.menuItemToModifiers.menuItemId, itemIds),
          isNull(schema.menuModifiers.deletedAt),
        ),
      );
    const attachedByItem = new Map<
      string,
      {
        modifierId: string;
        isRequired: boolean;
        multiSelect: boolean;
        maxSelections: number | null;
      }[]
    >();
    for (const row of attachRows) {
      const list = attachedByItem.get(row.menuItemId) ?? [];
      list.push({
        modifierId: row.modifierId,
        isRequired: row.isRequired,
        multiSelect: row.multiSelect,
        maxSelections: row.maxSelections,
      });
      attachedByItem.set(row.menuItemId, list);
    }

    let subtotal = 0;
    const resolvedItems = items.map((line) => {
      const menuItem = dbItemsMap.get(line.menuItemId);
      if (!menuItem) {
        throw new NotFoundException(
          `Menu item ${line.menuItemId} not found, unavailable, or not in this organization.`,
        );
      }

      const attached = attachedByItem.get(line.menuItemId) ?? [];
      const attachedGroupIds = new Set(attached.map((a) => a.modifierId));
      const selectionCounts = new Map<string, number>();

      const snapshots = (line.optionIds ?? []).map((optionId) => {
        const opt = optionMap.get(optionId);
        if (!opt) {
          throw new NotFoundException(
            `Modifier option ${optionId} not found in this organization.`,
          );
        }
        if (!attachedGroupIds.has(opt.modifierId)) {
          throw new BadRequestException(
            `Modifier option "${opt.name}" does not apply to menu item ${line.menuItemId}.`,
          );
        }
        selectionCounts.set(
          opt.modifierId,
          (selectionCounts.get(opt.modifierId) ?? 0) + 1,
        );
        return {
          optionId: opt.id,
          modifier: opt.modifierName,
          option: opt.name,
          priceAdjustment: opt.priceAdjustment,
        };
      });

      for (const group of attached) {
        const count = selectionCounts.get(group.modifierId) ?? 0;
        if (group.isRequired && count === 0) {
          throw new BadRequestException(
            `Menu item ${line.menuItemId} is missing a required modifier selection.`,
          );
        }
        if (!group.multiSelect && count > 1) {
          throw new BadRequestException(
            `Modifier group allows only 1 selection, but multiple were provided for menu item ${line.menuItemId}.`,
          );
        }
        if (
          group.multiSelect &&
          group.maxSelections !== null &&
          count > group.maxSelections
        ) {
          throw new BadRequestException(
            `Modifier group allows up to ${group.maxSelections} selections, but ${count} were provided.`,
          );
        }
      }

      const unitPrice =
        menuItem.price +
        snapshots.reduce((sum, s) => sum + s.priceAdjustment, 0);
      subtotal += unitPrice * line.quantity;

      return {
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        price: unitPrice,
        modifiers: snapshots.length > 0 ? snapshots : null,
        notes: line.notes?.trim() || null,
        course: line.course ?? null,
      };
    });

    return { resolvedItems, subtotal };
  }

  /**
   * Resolve an applied discount by id or promo code, org-scoped and active only.
   * Manager-only discounts are role-gated (PIN-based acting-user switching comes later).
   * Returns null when neither identifier is provided.
   */
  async resolveDiscount(
    orgId: string,
    user: CurrentUserPayload,
    opts: { discountId?: string; promoCode?: string },
  ) {
    if (!opts.discountId && !opts.promoCode?.trim()) return null;

    const conditions = [
      eq(schema.discounts.organizationId, orgId),
      eq(schema.discounts.active, true),
      isNull(schema.discounts.deletedAt),
    ];
    if (opts.discountId) {
      conditions.push(eq(schema.discounts.id, opts.discountId));
    } else {
      conditions.push(
        eq(schema.discounts.code, opts.promoCode!.trim().toUpperCase()),
      );
    }

    const [discount] = await this.db
      .select()
      .from(schema.discounts)
      .where(and(...conditions))
      .limit(1);

    if (!discount) {
      throw new NotFoundException(
        opts.discountId
          ? 'Discount not found or inactive.'
          : `Promo code "${opts.promoCode}" not found or inactive.`,
      );
    }
    if (discount.requiresManager && user.role === 'user') {
      throw new ForbiddenException(
        `"${discount.name}" requires manager approval.`,
      );
    }
    return discount;
  }

  /** Discount amount in cents, never exceeding the subtotal. */
  discountAmountFor(
    discount: { type: string; value: number } | null,
    subtotal: number,
  ): number {
    if (!discount) return 0;
    const raw =
      discount.type === 'percent'
        ? Math.round((subtotal * discount.value) / 100)
        : discount.value;
    return Math.min(subtotal, Math.max(0, raw));
  }

  /**
   * Determine the location an order belongs to: an explicit hint wins, then a non-null location
   * shared by the ordered items, then the org's single location. Returns null when the org has
   * multiple locations and nothing else disambiguates (caller records no usage in that case).
   */
  async resolveOrderLocation(
    orgId: string,
    hintedLocationId: string | undefined,
    itemLocationIds: (string | null)[],
  ): Promise<string | null> {
    if (hintedLocationId) return hintedLocationId;

    const distinctItemLocations = [
      ...new Set(itemLocationIds.filter((id): id is string => !!id)),
    ];
    if (distinctItemLocations.length === 1) {
      return distinctItemLocations[0];
    }

    const orgLocations = await this.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.organizationId, orgId),
          isNull(schema.locations.deletedAt),
        ),
      )
      .limit(2);

    if (orgLocations.length === 1) {
      return orgLocations[0].id;
    }

    return null;
  }

  /** The IANA timezone for a location, falling back to the platform default. */
  async getLocationTimezone(
    locationId: string,
    tx: Pick<NodePgDatabase<typeof schema>, 'select'> = this.db,
  ): Promise<string> {
    const [row] = await tx
      .select({ timezone: schema.locations.timezone })
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  /** Next per-location daily ticket number ("Order #47"). Runs inside the insert transaction. */
  async nextTicketNumber(
    tx: Pick<NodePgDatabase<typeof schema>, 'select' | 'execute'>,
    locationId: string,
  ): Promise<number> {
    // Serialize concurrent ticket-number allocations for this location within the
    // transaction — Postgres doesn't allow FOR UPDATE on an aggregate (MAX) query,
    // so without this lock two concurrent orders can read the same max and collide.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${locationId}))`,
    );

    // Reset the counter at the location's local midnight, not the server's — a
    // late-night order must keep counting up for the same business day (P2-009).
    const timezone = await this.getLocationTimezone(locationId, tx);
    const startOfDay = startOfBusinessDay(new Date(), timezone);
    const [row] = await tx
      .select({
        max: sql<number>`coalesce(max(${schema.orders.ticketNumber}), 0)`.mapWith(
          Number,
        ),
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.locationId, locationId),
          gte(schema.orders.createdAt, startOfDay),
        ),
      );
    return (row?.max ?? 0) + 1;
  }

  /** Throws unless the customer profile exists in this org. */
  async requireOrgCustomer(orgId: string, customerId: string) {
    const [customer] = await this.db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!customer) {
      throw new NotFoundException('Customer not found in your organization.');
    }
  }

  /** Fetch the tax rate (basis points) for a location. Returns 0 if not found. */
  async getTaxRate(locationId: string | null | undefined): Promise<number> {
    if (!locationId) return 0;
    const [loc] = await this.db
      .select({ taxRateBps: schema.locations.taxRateBps })
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);
    return loc?.taxRateBps ?? 0;
  }
}
