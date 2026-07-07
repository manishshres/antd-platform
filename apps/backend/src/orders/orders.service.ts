import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { OnEvent } from '@nestjs/event-emitter';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, inArray, count, isNull, desc, gte, sql } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { GetOrdersDto } from './dto/get-orders.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { AdjustOrderItemsDto } from './dto/adjust-order-items.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrintJobsService } from '../printers/print-jobs.service';
import { AuditService } from '../common/services/audit.service';
import { UsersService } from '../users/users.service';
import { EventsGateway } from '../events/events.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    private readonly analyticsService: AnalyticsService,
    @InjectQueue('print-queue')
    private readonly printQueue: Queue,
    private readonly printJobsService: PrintJobsService,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
    private readonly eventsGateway: EventsGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getOrders(
    user: CurrentUserPayload,
    query: GetOrdersDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    // Resolve the org from the JWT context (a platform admin's selected org via ?orgId=). This
    // scopes the list to that org instead of returning every tenant's orders unfiltered.
    const orgId = await this.billingService.getRequiredOrg(user);

    const { offset = 0, limit = 20, locationId, status } = query;

    const conditions = [isNull(schema.orders.deletedAt)];
    if (orgId) conditions.push(eq(schema.orders.organizationId, orgId));
    if (locationId) conditions.push(eq(schema.orders.locationId, locationId));
    if (status) conditions.push(eq(schema.orders.status, status));

    const whereClause = and(...conditions);

    const data = await this.db
      .select()
      .from(schema.orders)
      .where(whereClause)
      // Newest first — operators need the most recent orders at the top (H1).
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.orders)
      .where(whereClause);

    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }

  async getOrderById(user: CurrentUserPayload, orderId: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    return this.getOrderByIdForOrg(orgId, orderId);
  }

  async getOrderByIdForOrg(orgId: string, orderId: string) {
    const orderRes = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, orgId),
        ),
      )
      .limit(1);

    const order = orderRes[0];
    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    // Fetch order items and join with menu item details
    const itemsRes = await this.db
      .select({
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        price: schema.orderItems.price,
        modifiers: schema.orderItems.modifiers,
        notes: schema.orderItems.notes,
        menuItemId: schema.orderItems.menuItemId,
        menuItemName: schema.menuItems.name,
      })
      .from(schema.orderItems)
      .innerJoin(
        schema.menuItems,
        eq(schema.orderItems.menuItemId, schema.menuItems.id),
      )
      .where(eq(schema.orderItems.orderId, orderId));

    const paymentsRes = await this.db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    return {
      ...order,
      items: itemsRes,
      payments: paymentsRes,
    };
  }

  async createOrder(
    user: CurrentUserPayload,
    customerName: string,
    customerPhone: string,
    items: { menuItemId: string; quantity: number }[],
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    return this.createOrderForOrg(
      orgId,
      customerName,
      customerPhone,
      items,
      user.id,
    );
  }

  @OnEvent('order.incoming')
  async handleOrderIncomingEvent(payload: {
    orgId: string;
    customerName: string;
    customerPhone: string;
    items: { menuItemId: string; quantity: number }[];
    orderType?: string;
    specialInstructions?: string;
  }) {
    return this.createOrderForOrg(
      payload.orgId,
      payload.customerName,
      payload.customerPhone,
      payload.items,
      undefined,
      undefined,
      payload.orderType,
      payload.specialInstructions,
    );
  }

  async createOrderForOrg(
    orgId: string,
    customerName: string,
    customerPhone: string,
    items: { menuItemId: string; quantity: number }[],
    userId?: string,
    locationId?: string,
    orderType?: string,
    specialInstructions?: string,
  ) {
    if (items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    // Resolve menu items (batch query avoiding N+1), scoped to the org via their category and
    // restricted to available, non-deleted items (H5). Items from other tenants — or deleted/
    // unavailable ones — must never price into an order.
    const itemIds = items.map((i) => i.menuItemId);
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

    const dbItemsMap = new Map(dbItems.map((dbItem) => [dbItem.id, dbItem]));

    let totalAmount = 0;
    const resolvedItems: {
      menuItemId: string;
      quantity: number;
      price: number;
    }[] = [];

    for (const item of items) {
      const menuItem = dbItemsMap.get(item.menuItemId);
      if (!menuItem) {
        throw new NotFoundException(
          `Menu item ${item.menuItemId} not found, unavailable, or not in this organization.`,
        );
      }

      totalAmount += menuItem.price * item.quantity;
      resolvedItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: menuItem.price,
      });
    }

    // Resolve the owning location (H5): prefer an explicit hint, else the location carried by
    // the ordered items, else the org's single location. Persisted so location-scoped lists,
    // dashboards and usage billing include AI-generated orders.
    const resolvedLocationId = await this.resolveOrderLocation(
      orgId,
      locationId,
      dbItems.map((i) => i.locationId),
    );

    // Apply the location's flat sales tax (basis points). Orders without a resolvable
    // location are charged tax-free rather than guessing a rate.
    let taxRateBps = 0;
    if (resolvedLocationId) {
      const [loc] = await this.db
        .select({ taxRateBps: schema.locations.taxRateBps })
        .from(schema.locations)
        .where(eq(schema.locations.id, resolvedLocationId))
        .limit(1);
      taxRateBps = loc?.taxRateBps ?? 0;
    }
    const subtotal = totalAmount;
    const taxAmount = Math.round((subtotal * taxRateBps) / 10000);
    totalAmount = subtotal + taxAmount;

    // Insert order and items within a transaction
    const orderId = await this.db.transaction(async (tx) => {
      const ticketNumber = resolvedLocationId
        ? await this.nextTicketNumber(tx, resolvedLocationId)
        : null;
      const newOrders = await tx
        .insert(schema.orders)
        .values({
          organizationId: orgId,
          locationId: resolvedLocationId,
          customerName,
          customerPhone,
          status: 'pending',
          subtotal,
          taxAmount,
          totalAmount,
          orderType: orderType ?? null,
          specialInstructions: specialInstructions ?? null,
          source: 'ai_phone',
          ticketNumber,
        })
        .returning();

      const order = newOrders[0];
      if (!order) {
        throw new BadRequestException('Failed to create order.');
      }

      await tx.insert(schema.orderItems).values(
        resolvedItems.map((resItem) => ({
          orderId: order.id,
          menuItemId: resItem.menuItemId,
          quantity: resItem.quantity,
          price: resItem.price,
        })),
      );

      return order.id;
    });

    return this.dispatchOrderSideEffects(orgId, orderId, userId, {
      totalAmount,
      items: resolvedItems,
      status: 'pending',
    });
  }

  /**
   * Shared post-insert pipeline for every order channel (AI webhook, mock generator, POS):
   * fetch the full order, enqueue kitchen + receipt print jobs, write the audit entry, record
   * usage, and broadcast the order to the org's realtime room.
   */
  private async dispatchOrderSideEffects(
    orgId: string,
    orderId: string,
    userId: string | undefined,
    auditNewValue: Record<string, unknown>,
  ) {
    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    // Creation is the 'save' event; an order created already-paid (POS charge)
    // fires 'paid' too — each document still prints at most once.
    await this.printForEvents(
      orgId,
      fullOrder,
      fullOrder.paidAt ? ['save', 'paid'] : ['save'],
    );

    void this.auditService.log({
      action: 'order.create',
      userId,
      organizationId: orgId,
      entityType: 'order',
      entityId: fullOrder.id,
      newValue: auditNewValue,
    });

    // Only record usage when we resolved a real location — usage_events.locationId is a
    // NOT NULL FK to locations, so the previous `locationId || orgId` fallback silently failed
    // and under-counted order volume for billing (H5).
    if (fullOrder.locationId) {
      void this.analyticsService.recordUsage(
        orgId,
        fullOrder.locationId,
        'order_volume',
        1,
        { orderId: fullOrder.id },
      );
    } else {
      this.logger.warn(
        `Order ${fullOrder.id} has no resolvable location; skipping usage recording.`,
      );
    }

    this.eventsGateway.emitToOrganization(orgId, 'order.created', fullOrder);
    this.eventEmitter.emit('order.created', { orgId, fullOrder });

    return fullOrder;
  }

  /**
   * Create an order from the in-store POS register. Prices items AND selected modifier options
   * server-side (never trusting client math), snapshots modifier selections onto the order items,
   * and records how the order was paid ('cash' | 'card' — detailed payment processing is a later
   * phase). POS orders are paid up front, so they enter the pipeline as 'confirmed'.
   */
  /**
   * Price a POS cart server-side: base item prices and modifier option adjustments come from
   * the DB (org-scoped, available, non-deleted), option→item attachment is validated, and
   * required modifier groups are enforced. Snapshots include the optionId so an order can be
   * re-opened and edited in the register later.
   */
  private async priceCartItems(
    orgId: string,
    items: {
      menuItemId: string;
      quantity: number;
      optionIds?: string[];
      notes?: string;
      course?: number;
    }[],
  ) {
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
      { modifierId: string; isRequired: boolean; multiSelect: boolean; maxSelections: number | null }[]
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
        selectionCounts.set(opt.modifierId, (selectionCounts.get(opt.modifierId) ?? 0) + 1);
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
        if (group.multiSelect && group.maxSelections !== null && count > group.maxSelections) {
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
   * Per-location printing behavior with safe defaults: both ticket types enabled,
   * one copy each; copies clamped to 1–5.
   */
  /**
   * Per-location printing policy as an event matrix: each document type (kitchen
   * ticket, customer receipt) declares which order events trigger it — save
   * (creation), update (unpaid edit), paid — plus a copy count (1–5).
   * Legacy enable/hold settings are normalized into the matrix.
   */
  private async getPrintPlan(locationId: string | null | undefined) {
    const clampCopies = (v: unknown) =>
      Math.min(5, Math.max(1, Math.round(Number(v)) || 1));
    // Defaults: kitchen fires on save + update; receipt only at payment.
    const defaults = {
      kitchen: { onSave: true, onUpdate: true, onPaid: false, copies: 1 },
      receipt: { onSave: false, onUpdate: false, onPaid: true, copies: 1 },
    };
    if (!locationId) return defaults;

    const [loc] = await this.db
      .select({ printSettings: schema.locations.printSettings })
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);
    const s = (loc?.printSettings ?? {}) as Record<string, unknown>;

    const matrix = (
      doc: 'kitchen' | 'receipt',
    ): { onSave: boolean; onUpdate: boolean; onPaid: boolean; copies: number } => {
      const m = s[doc] as Record<string, unknown> | undefined;
      if (m && typeof m === 'object') {
        return {
          onSave: m.onSave === true,
          onUpdate: m.onUpdate === true,
          onPaid: m.onPaid === true,
          copies: clampCopies(m.copies),
        };
      }
      // Legacy shape: kitchenEnabled/receiptEnabled + copies + holdUnpaidKitchen.
      const enabled = s[`${doc}Enabled`] !== false;
      const copies = clampCopies(s[`${doc}Copies`]);
      if (doc === 'kitchen') {
        const hold = s.holdUnpaidKitchen === true;
        return {
          onSave: enabled && !hold,
          onUpdate: enabled && !hold,
          onPaid: enabled && hold,
          copies,
        };
      }
      return { onSave: false, onUpdate: false, onPaid: enabled, copies };
    };

    return { kitchen: matrix('kitchen'), receipt: matrix('receipt') };
  }

  /** Build the printable representation of an order for either document type. */
  private buildPrintPayload(
    fullOrder: Awaited<ReturnType<OrdersService['getOrderByIdForOrg']>>,
    opts: { updated?: boolean } = {},
  ) {
    return {
      orderId: fullOrder.id,
      ticketNumber: fullOrder.ticketNumber ?? undefined,
      updated: opts.updated || undefined,
      customerName: fullOrder.customerName,
      customerPhone: fullOrder.customerPhone,
      subtotal: fullOrder.subtotal ?? undefined,
      taxAmount: fullOrder.taxAmount ?? undefined,
      tipAmount: fullOrder.tipAmount ?? undefined,
      discountAmount: fullOrder.discountAmount ?? undefined,
      discountName: fullOrder.discountName ?? undefined,
      totalAmount: fullOrder.totalAmount,
      orderType: fullOrder.orderType,
      specialInstructions: fullOrder.specialInstructions,
      items: fullOrder.items.map((item) => ({
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        price: item.price,
        modifiers: item.modifiers ?? undefined,
        notes: item.notes ?? undefined,
      })),
      createdAt: fullOrder.createdAt,
    };
  }

  /**
   * Enqueue every document whose matrix row is checked for any of the given
   * events. A document prints at most once per call even when several of its
   * events fire together (e.g. a POS order created already-paid = save + paid).
   */
  private async printForEvents(
    orgId: string,
    fullOrder: Awaited<ReturnType<OrdersService['getOrderByIdForOrg']>>,
    events: ('save' | 'update' | 'paid')[],
    opts: { updated?: boolean } = {},
  ) {
    try {
      const plan = await this.getPrintPlan(fullOrder.locationId);
      const payload = this.buildPrintPayload(fullOrder, opts);
      for (const jobType of ['kitchen', 'receipt'] as const) {
        const cfg = plan[jobType];
        const triggered =
          (events.includes('save') && cfg.onSave) ||
          (events.includes('update') && cfg.onUpdate) ||
          (events.includes('paid') && cfg.onPaid);
        if (!triggered) continue;
        for (let copy = 0; copy < cfg.copies; copy++) {
          // createPrintJob records history AND enqueues on the print queue
          // (deduped by jobId) — adding to the queue again here caused every
          // ticket to be published twice; the printer printed the first copy
          // and reported Discard for the duplicate.
          await this.printJobsService.createPrintJob({
            organizationId: orgId,
            orderId: fullOrder.id,
            jobType,
            payload,
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to enqueue print jobs for order ${fullOrder.id}: ${msg}`,
      );
    }
  }

  /**
   * Resolve an applied discount by id or promo code, org-scoped and active only.
   * Manager-only discounts are role-gated (PIN-based acting-user switching comes later).
   * Returns null when neither identifier is provided.
   */
  private async resolveDiscount(
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
  private discountAmountFor(
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

  /** Next per-location daily ticket number ("Order #47"). Runs inside the insert transaction. */
  private async nextTicketNumber(
    tx: Pick<NodePgDatabase<typeof schema>, 'select'>,
    locationId: string,
  ): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
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

  async createPosOrder(
    user: CurrentUserPayload,
    dto: {
      locationId: string;
      customerId?: string;
      customerName?: string;
      customerPhone?: string;
      tableId?: string;
      orderType?: string;
      specialInstructions?: string;
      /** Omitted = save unpaid (dine-in / pay-later); kitchen fires, receipt waits. */
      paymentMethod?: string;
      tipAmount?: number;
      discountId?: string;
      promoCode?: string;
      items: {
        menuItemId: string;
        quantity: number;
        optionIds?: string[];
        notes?: string;
        course?: number;
      }[];
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    if (dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    // Validate the location belongs to this org and pick up its tax rate.
    const [location] = await this.db
      .select({
        id: schema.locations.id,
        taxRateBps: schema.locations.taxRateBps,
      })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, dto.locationId),
          eq(schema.locations.organizationId, orgId),
          isNull(schema.locations.deletedAt),
        ),
      )
      .limit(1);
    if (!location) {
      throw new NotFoundException('Location not found in your organization.');
    }

    const { resolvedItems, subtotal } = await this.priceCartItems(
      orgId,
      dto.items,
    );

    // Discount reduces the taxable base; tax on the discounted subtotal; tip added after tax.
    const discount = await this.resolveDiscount(orgId, user, dto);
    const discountAmount = this.discountAmountFor(discount, subtotal);
    const taxableBase = subtotal - discountAmount;
    const taxAmount = Math.round((taxableBase * location.taxRateBps) / 10000);
    const tipAmount = Math.max(0, Math.round(dto.tipAmount ?? 0));
    const totalAmount = taxableBase + taxAmount + tipAmount;

    const now = new Date();
    const orderId = await this.db.transaction(async (tx) => {
      const ticketNumber = await this.nextTicketNumber(tx, dto.locationId);
      const [order] = await tx
        .insert(schema.orders)
        .values({
          organizationId: orgId,
          locationId: dto.locationId,
          customerId: dto.customerId || null,
          tableId: dto.tableId || null,
          customerName: dto.customerName?.trim() || 'Walk-in',
          customerPhone: dto.customerPhone?.trim() || '',
          status: 'confirmed',
          subtotal,
          taxAmount,
          tipAmount,
          discountAmount,
          discountName: discount?.name ?? null,
          discountId: discount?.id ?? null,
          totalAmount,
          orderType: dto.orderType ?? 'dine_in',
          specialInstructions: dto.specialInstructions ?? null,
          source: 'pos',
          paymentMethod: dto.paymentMethod ?? null,
          paidAt: dto.paymentMethod ? now : null,
          ticketNumber,
        })
        .returning();

      if (!order) {
        throw new BadRequestException('Failed to create order.');
      }

      await tx.insert(schema.orderItems).values(
        resolvedItems.map((item) => ({
          orderId: order.id,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          price: item.price,
          modifiers: item.modifiers,
          notes: item.notes,
          course: item.course,
        })),
      );

      return order.id;
    });

    return this.dispatchOrderSideEffects(orgId, orderId, user.id, {
      subtotal,
      taxAmount,
      tipAmount,
      discountAmount,
      discountName: discount?.name ?? null,
      totalAmount,
      items: resolvedItems,
      status: 'confirmed',
      source: 'pos',
      paymentMethod: dto.paymentMethod,
    });
  }

  /**
   * Replace the items (and optionally customer/type/notes) of an order that has not been paid
   * yet — the AI-voice → POS handoff: phone orders arrive unpaid, the cashier opens them in the
   * register, adjusts, and takes payment. Re-prices everything server-side and fires a corrected
   * kitchen ticket marked "UPDATED".
   */
  async updateOrderItems(
    user: CurrentUserPayload,
    orderId: string,
    dto: {
      customerId?: string;
      customerName?: string;
      customerPhone?: string;
      tableId?: string;
      orderType?: string;
      specialInstructions?: string;
      discountId?: string;
      promoCode?: string;
      items: {
        menuItemId: string;
        quantity: number;
        optionIds?: string[];
        notes?: string;
        course?: number;
      }[];
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    if (dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    const order = await this.getOrderByIdForOrg(orgId, orderId);
    if (order.paidAt) {
      throw new BadRequestException(
        'Paid orders cannot be edited. Use a refund/void instead.',
      );
    }
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new BadRequestException(
        `Orders in status "${order.status}" can no longer be edited.`,
      );
    }
    // Re-pricing could push the total below money already taken — lock items
    // once any partial payment exists.
    if ((await this.paidSumFor(orderId)) > 0) {
      throw new BadRequestException(
        'Orders with recorded payments cannot be edited.',
      );
    }

    const { resolvedItems, subtotal } = await this.priceCartItems(
      orgId,
      dto.items,
    );

    let taxRateBps = 0;
    if (order.locationId) {
      const [loc] = await this.db
        .select({ taxRateBps: schema.locations.taxRateBps })
        .from(schema.locations)
        .where(eq(schema.locations.id, order.locationId))
        .limit(1);
      taxRateBps = loc?.taxRateBps ?? 0;
    }

    // Same tender math as createPosOrder: discount → taxable base → tax; any tip already
    // recorded on the order is preserved (tips normally land at payment time).
    const discount = await this.resolveDiscount(orgId, user, dto);
    const discountAmount = this.discountAmountFor(discount, subtotal);
    const taxableBase = subtotal - discountAmount;
    const taxAmount = Math.round((taxableBase * taxRateBps) / 10000);
    const existingTip = order.tipAmount ?? 0;
    const totalAmount = taxableBase + taxAmount + existingTip;

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({
          subtotal,
          taxAmount,
          discountAmount,
          discountName: discount?.name ?? null,
          discountId: discount?.id ?? null,
          totalAmount,
          ...(dto.customerId !== undefined ? { customerId: dto.customerId || null } : {}),
          ...(dto.tableId !== undefined ? { tableId: dto.tableId || null } : {}),
          ...(dto.customerName !== undefined
            ? { customerName: dto.customerName.trim() || 'Walk-in' }
            : {}),
          ...(dto.orderType !== undefined ? { orderType: dto.orderType } : {}),
          ...(dto.specialInstructions !== undefined
            ? { specialInstructions: dto.specialInstructions || null }
            : {}),
          ...(dto.customerPhone !== undefined
            ? { customerPhone: dto.customerPhone.trim() || '' }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      await tx
        .delete(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
      await tx.insert(schema.orderItems).values(
        resolvedItems.map((item) => ({
          orderId,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          price: item.price,
          modifiers: item.modifiers,
          notes: item.notes,
          course: item.course,
        })),
      );
    });

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    // 'update' event — documents whose matrix row has On Update checked print a
    // corrected copy (payload marked updated).
    await this.printForEvents(orgId, fullOrder, ['update'], { updated: true });

    void this.auditService.log({
      action: 'order.items.update',
      userId: user.id,
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      previousValue: { totalAmount: order.totalAmount, items: order.items },
      newValue: { subtotal, taxAmount, totalAmount, items: resolvedItems },
    });

    this.eventsGateway.emitToOrganization(orgId, 'order.updated', fullOrder);
    return fullOrder;
  }

  /**
   * Record payment on an unpaid order (cash | card — detailed payment processing lands later)
   * and move a pending order into the kitchen pipeline.
   */
  /** Sum of payments already recorded against an order (cents). */
  private async paidSumFor(orderId: string): Promise<number> {
    const [row] = await this.db
      .select({
        sum: sql<number>`coalesce(sum(${schema.payments.amount}), 0)`.mapWith(
          Number,
        ),
      })
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));
    return row?.sum ?? 0;
  }

  /**
   * Record a (possibly partial) payment against an unpaid order — the split-check
   * primitive. The order flips to paid when recorded payments cover the total;
   * `paymentMethod` becomes 'split' when methods differ. A tip on a payment is
   * added to the order total at that moment. Cash payments persist what the
   * customer handed over and the change returned.
   */
  async recordPayment(
    user: CurrentUserPayload,
    orderId: string,
    dto: {
      method: string;
      /** Cents to apply; omit to pay the full remaining balance. */
      amount?: number;
      cashReceived?: number;
      tipAmount?: number;
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const order = await this.getOrderByIdForOrg(orgId, orderId);
    if (order.paidAt) {
      throw new BadRequestException('This order has already been paid.');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('Cancelled orders cannot be paid.');
    }

    const priorPaid = await this.paidSumFor(orderId);
    const tip = Math.max(0, Math.round(dto.tipAmount ?? 0));
    const newTotal = order.totalAmount + tip;
    const remainingBefore = newTotal - priorPaid;
    if (remainingBefore <= 0) {
      throw new BadRequestException('This order has no remaining balance.');
    }

    const requested =
      dto.amount != null ? Math.round(dto.amount) : remainingBefore;
    if (requested <= 0) {
      throw new BadRequestException('Payment amount must be positive.');
    }
    const applied = Math.min(requested, remainingBefore);

    let cashReceived: number | null = null;
    let changeGiven: number | null = null;
    if (dto.method === 'cash' && dto.cashReceived != null) {
      cashReceived = Math.round(dto.cashReceived);
      if (cashReceived < applied) {
        throw new BadRequestException(
          'Cash received is less than the payment amount.',
        );
      }
      changeGiven = cashReceived - applied;
    }

    const coversTotal = priorPaid + applied >= newTotal;

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.payments).values({
        organizationId: orgId,
        locationId: order.locationId,
        orderId,
        method: dto.method,
        amount: applied,
        tipAmount: tip,
        cashReceived,
        changeGiven,
        createdBy: user.id,
      });

      // Which single method (or 'split') describes the order so far?
      const methodRows = await tx
        .selectDistinct({ method: schema.payments.method })
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderId));
      const summaryMethod =
        methodRows.length > 1 ? 'split' : (methodRows[0]?.method ?? dto.method);

      await tx
        .update(schema.orders)
        .set({
          tipAmount: (order.tipAmount ?? 0) + tip,
          totalAmount: newTotal,
          paymentMethod: summaryMethod,
          ...(coversTotal
            ? {
                paidAt: new Date(),
                status: order.status === 'pending' ? 'confirmed' : order.status,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));
    });

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    if (coversTotal) {
      await this.printForEvents(orgId, fullOrder, ['paid']);
    }

    void this.auditService.log({
      action: 'order.payment.recorded',
      userId: user.id,
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      newValue: {
        method: dto.method,
        applied,
        tipAmount: tip,
        cashReceived,
        changeGiven,
        paid: coversTotal,
      },
    });
    this.eventsGateway.emitToOrganization(orgId, 'order.updated', fullOrder);

    return {
      applied,
      changeGiven,
      remaining: newTotal - priorPaid - applied,
      paid: coversTotal,
      order: fullOrder,
    };
  }

  /**
   * Record full payment on an unpaid order (the simple non-split flow) — a thin
   * wrapper over recordPayment that pays the entire remaining balance.
   */
  async payOrder(
    user: CurrentUserPayload,
    orderId: string,
    paymentMethod: string,
    tipAmount?: number,
  ) {
    // recordPayment handles printing, audit, and realtime events.
    const { order: fullOrder } = await this.recordPayment(user, orderId, {
      method: paymentMethod,
      tipAmount,
    });
    return fullOrder;
  }

  /**
   * Determine the location an order belongs to: an explicit hint wins, then a non-null location
   * shared by the ordered items, then the org's single location. Returns null when the org has
   * multiple locations and nothing else disambiguates (caller records no usage in that case).
   */
  private async resolveOrderLocation(
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

  async updateOrderStatus(
    user: CurrentUserPayload,
    orderId: string,
    status: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    const validStatuses = [
      'pending',
      'preparing',
      'ready',
      'completed',
      'cancelled',
    ];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid order status: ${status}`);
    }

    const orderRes = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, orgId),
        ),
      );

    if (orderRes.length === 0) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const currentStatus = orderRes[0].status;
    const transitionMap: Record<string, string[]> = {
      pending: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['completed'],
      completed: [],
      cancelled: [],
    };

    const allowedNextStatuses = transitionMap[currentStatus] || [];

    if (!allowedNextStatuses.includes(status)) {
      throw new BadRequestException(
        `Cannot transition order status from '${currentStatus}' to '${status}'.`,
      );
    }

    await this.db
      .update(schema.orders)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));

    void this.auditService.log({
      action: 'order.status_update',
      userId: user.id,
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      previousValue: { status: orderRes[0].status },
      newValue: { status },
    });

    const updatedOrder = await this.getOrderById(user, orderId);
    this.eventsGateway.emitToOrganization(orgId, 'order.updated', updatedOrder);
    this.eventEmitter.emit('order.updated', { orgId, updatedOrder });

    return updatedOrder;
  }

  async getOrderPrintJobs(
    user: CurrentUserPayload,
    orderId: string,
    filters?: { status?: string; jobType?: string },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    await this.getOrderByIdForOrg(orgId, orderId);

    return this.printJobsService.listOrderPrintJobs(orgId, orderId, filters);
  }

  async printOrder(
    user: CurrentUserPayload,
    orderId: string,
    printerId?: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    const printPayload = {
      orderId: fullOrder.id,
      customerName: fullOrder.customerName,
      customerPhone: fullOrder.customerPhone,
      subtotal: fullOrder.subtotal ?? undefined,
      taxAmount: fullOrder.taxAmount ?? undefined,
      tipAmount: fullOrder.tipAmount ?? undefined,
      discountAmount: fullOrder.discountAmount ?? undefined,
      discountName: fullOrder.discountName ?? undefined,
      totalAmount: fullOrder.totalAmount,
      items: fullOrder.items.map((item) => ({
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        price: item.price,
      })),
      createdAt: fullOrder.createdAt,
      printerId,
    };

    this.logger.log(
      `Enqueuing print jobs for order ${fullOrder.id} (printerId=${printerId ?? 'none'})`,
    );

    const kitchenPrintJob = await this.printJobsService.createPrintJob({
      organizationId: orgId,
      orderId: fullOrder.id,
      jobType: 'kitchen',
      printerId,
      payload: printPayload,
    });

    const receiptPrintJob = await this.printJobsService.createPrintJob({
      organizationId: orgId,
      orderId: fullOrder.id,
      jobType: 'receipt',
      printerId,
      payload: printPayload,
    });

    // createPrintJob already enqueued both (deduped by jobId) — no second add,
    // which used to double-deliver every ticket to the printer.
    this.logger.log(
      `Queued print jobs for order ${fullOrder.id}: kitchen=${kitchenPrintJob.id}, receipt=${receiptPrintJob.id}`,
    );

    return {
      success: true,
      message: 'Print jobs enqueued successfully.',
      kitchenJobId: kitchenPrintJob.id,
      receiptJobId: receiptPrintJob.id,
    };
  }

  async refundPaidOrder(
    user: CurrentUserPayload,
    orderId: string,
    managerPin: string,
    reason?: string,
  ): Promise<unknown> {
    // 1. Verify manager PIN
    const manager = await this.usersService.verifyManagerPin(
      user.organizationId!,
      managerPin,
    );
    if (!manager) {
      throw new ForbiddenException('Invalid manager PIN.');
    }

    // 2. Load order and its payments
    const orderRes = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, user.organizationId!),
        ),
      )
      .limit(1);

    const order = orderRes[0];
    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    if (order.status === 'cancelled') {
      throw new BadRequestException('Order is already cancelled/refunded.');
    }
    if (!order.paidAt && !order.paymentMethod) {
      throw new BadRequestException('Order is not paid.');
    }

    const orderPayments = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, order.id));

    // 3. Mark as cancelled and insert negative payments inside a transaction
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      for (const p of orderPayments) {
        if (p.amount > 0) {
          await tx.insert(schema.payments).values({
            organizationId: p.organizationId,
            locationId: p.locationId,
            orderId: p.orderId,
            method: p.method,
            amount: -p.amount,
            tipAmount: -p.tipAmount,
            cashReceived: p.cashReceived ? -p.cashReceived : null,
            changeGiven: p.changeGiven ? -p.changeGiven : null,
            createdBy: manager.id,
          });
        }
      }

      await this.auditService.log({
        organizationId: user.organizationId,
        userId: manager.id,
        action: 'order.refunded',
        entityType: 'order',
        entityId: order.id,
        newValue: { orderId: order.id, originalTotal: order.totalAmount, reason },
      });
    });

    this.eventsGateway.emitToOrganization(user.organizationId!, 'order.updated', {
      id: order.id,
      status: 'cancelled',
    });

    return { success: true, message: 'Order voided and refunded.' };
  }

  async refundPartialOrder(
    user: CurrentUserPayload,
    orderId: string,
    dto: PartialRefundDto,
  ): Promise<unknown> {
    const manager = await this.usersService.verifyManagerPin(
      user.organizationId!,
      dto.managerPin,
    );
    if (!manager) {
      throw new ForbiddenException('Invalid manager PIN.');
    }

    const orderRes = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, user.organizationId!),
        ),
      )
      .limit(1);

    const order = orderRes[0];
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'cancelled') {
      throw new BadRequestException('Order is cancelled.');
    }
    if (!order.paidAt) {
      throw new BadRequestException('Order is not paid.');
    }

    await this.db.transaction(async (tx) => {
      // Create negative payment record
      await tx.insert(schema.payments).values({
        organizationId: order.organizationId,
        locationId: order.locationId,
        orderId: order.id,
        method: order.paymentMethod || 'cash',
        amount: -dto.amount,
        tipAmount: 0,
        createdBy: manager.id,
      });

      await this.auditService.log({
        organizationId: user.organizationId,
        userId: manager.id,
        action: 'order.refund_partial',
        entityType: 'order',
        entityId: order.id,
        newValue: { amount: dto.amount, reason: dto.reason },
      });
    });

    return { success: true, message: `Refunded $${(dto.amount / 100).toFixed(2)}` };
  }

  async adjustOrderItems(
    user: CurrentUserPayload,
    orderId: string,
    dto: AdjustOrderItemsDto,
  ): Promise<unknown> {
    const manager = await this.usersService.verifyManagerPin(
      user.organizationId!,
      dto.managerPin,
    );
    if (!manager) {
      throw new ForbiddenException('Invalid manager PIN.');
    }

    const orderRes = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, user.organizationId!),
        ),
      )
      .limit(1);

    const order = orderRes[0];
    if (!order) throw new NotFoundException('Order not found.');

    const oldItemsRes = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    const { resolvedItems, subtotal: newSubtotal } = await this.priceCartItems(
      user.organizationId!,
      dto.items,
    );

    // In a full implementation we would recalculate tax, discount, tip perfectly.
    // For now, we adjust total by the subtotal difference.
    const oldSubtotal = oldItemsRes.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const subtotalDiff = newSubtotal - oldSubtotal;
    const newTotal = Math.max(0, order.totalAmount + subtotalDiff);
    const balanceDiff = newTotal - order.totalAmount;

    await this.db.transaction(async (tx) => {
      // 1. Update order total
      await tx
        .update(schema.orders)
        .set({
          totalAmount: newTotal,
          updatedAt: new Date(),
          paidAt: balanceDiff > 0 ? null : order.paidAt, // Un-pay if balance is due
        })
        .where(eq(schema.orders.id, order.id));

      // 2. Overwrite items
      await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      if (resolvedItems.length > 0) {
        await tx.insert(schema.orderItems).values(
          resolvedItems.map((it) => ({
            orderId: order.id,
            menuItemId: it.menuItemId,
            quantity: it.quantity,
            price: it.price,
            notes: it.notes,
            modifiers: it.modifiers,
          })),
        );
      }

      // 3. Issue partial refund if negative balance difference
      if (balanceDiff < 0) {
        const refundAmt = Math.abs(balanceDiff);
        await tx.insert(schema.payments).values({
          organizationId: order.organizationId,
          locationId: order.locationId,
          orderId: order.id,
          method: order.paymentMethod || 'cash',
          amount: -refundAmt,
          tipAmount: 0,
          createdBy: manager.id,
        });
      }

      // 4. Audit Log
      await this.auditService.log({
        organizationId: user.organizationId,
        userId: manager.id,
        action: 'order.adjust_items',
        entityType: 'order',
        entityId: order.id,
        previousValue: { items: oldItemsRes, totalAmount: order.totalAmount },
        newValue: { items: dto.items, totalAmount: newTotal, reason: dto.reason, balanceDiff },
      });
    });

    this.eventsGateway.emitToOrganization(user.organizationId!, 'order.updated', {
      id: order.id,
      status: order.status,
    });

    return { 
      success: true, 
      message: balanceDiff < 0 ? `Adjusted. Refunded $${(Math.abs(balanceDiff) / 100).toFixed(2)}.` : 'Items adjusted.',
      newTotal,
      balanceDiff
    };
  }
}

