import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
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
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrintJobsService } from '../printers/print-jobs.service';
import { AuditService } from '../common/services/audit.service';
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

    return {
      ...order,
      items: itemsRes,
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

    // Format print job payload
    const printPayload = {
      orderId: fullOrder.id,
      ticketNumber: fullOrder.ticketNumber ?? undefined,
      customerName: fullOrder.customerName,
      customerPhone: fullOrder.customerPhone,
      subtotal: fullOrder.subtotal ?? undefined,
      taxAmount: fullOrder.taxAmount ?? undefined,
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

    // Create print job history records and enqueue print jobs
    try {
      const kitchenPrintJob = await this.printJobsService.createPrintJob({
        organizationId: orgId,
        orderId: fullOrder.id,
        jobType: 'kitchen',
        payload: printPayload,
      });

      const receiptPrintJob = await this.printJobsService.createPrintJob({
        organizationId: orgId,
        orderId: fullOrder.id,
        jobType: 'receipt',
        payload: printPayload,
      });

      await this.printQueue.add('print-job', {
        orgId,
        type: 'kitchen',
        payload: printPayload,
        printJobId: kitchenPrintJob.id,
      });

      await this.printQueue.add('print-job', {
        orgId,
        type: 'receipt',
        payload: printPayload,
        printJobId: receiptPrintJob.id,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to enqueue print jobs for order ${orderId}: ${message}`,
      );
    }

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
      { modifierId: string; isRequired: boolean }[]
    >();
    for (const row of attachRows) {
      const list = attachedByItem.get(row.menuItemId) ?? [];
      list.push({ modifierId: row.modifierId, isRequired: row.isRequired });
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
      const selectedGroupIds = new Set<string>();

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
        selectedGroupIds.add(opt.modifierId);
        return {
          optionId: opt.id,
          modifier: opt.modifierName,
          option: opt.name,
          priceAdjustment: opt.priceAdjustment,
        };
      });

      for (const group of attached) {
        if (group.isRequired && !selectedGroupIds.has(group.modifierId)) {
          throw new BadRequestException(
            `Menu item ${line.menuItemId} is missing a required modifier selection.`,
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
      };
    });

    return { resolvedItems, subtotal };
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
      customerName?: string;
      customerPhone?: string;
      orderType?: string;
      specialInstructions?: string;
      paymentMethod: string;
      items: {
        menuItemId: string;
        quantity: number;
        optionIds?: string[];
        notes?: string;
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

    // Tax computed server-side from the location's flat rate (basis points).
    const taxAmount = Math.round((subtotal * location.taxRateBps) / 10000);
    const totalAmount = subtotal + taxAmount;

    const now = new Date();
    const orderId = await this.db.transaction(async (tx) => {
      const ticketNumber = await this.nextTicketNumber(tx, dto.locationId);
      const [order] = await tx
        .insert(schema.orders)
        .values({
          organizationId: orgId,
          locationId: dto.locationId,
          customerName: dto.customerName?.trim() || 'Walk-in',
          customerPhone: dto.customerPhone?.trim() || '',
          status: 'confirmed',
          subtotal,
          taxAmount,
          totalAmount,
          orderType: dto.orderType ?? 'dine_in',
          specialInstructions: dto.specialInstructions ?? null,
          source: 'pos',
          paymentMethod: dto.paymentMethod,
          paidAt: now,
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
        })),
      );

      return order.id;
    });

    return this.dispatchOrderSideEffects(orgId, orderId, user.id, {
      subtotal,
      taxAmount,
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
      customerName?: string;
      orderType?: string;
      specialInstructions?: string;
      items: {
        menuItemId: string;
        quantity: number;
        optionIds?: string[];
        notes?: string;
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
    const taxAmount = Math.round((subtotal * taxRateBps) / 10000);
    const totalAmount = subtotal + taxAmount;

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({
          subtotal,
          taxAmount,
          totalAmount,
          ...(dto.customerName !== undefined
            ? { customerName: dto.customerName.trim() || 'Walk-in' }
            : {}),
          ...(dto.orderType !== undefined ? { orderType: dto.orderType } : {}),
          ...(dto.specialInstructions !== undefined
            ? { specialInstructions: dto.specialInstructions || null }
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
        })),
      );
    });

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    // Fire a corrected kitchen ticket so the line knows the order changed.
    try {
      const printPayload = {
        orderId: fullOrder.id,
        ticketNumber: fullOrder.ticketNumber ?? undefined,
        updated: true,
        customerName: fullOrder.customerName,
        customerPhone: fullOrder.customerPhone,
        subtotal: fullOrder.subtotal ?? undefined,
        taxAmount: fullOrder.taxAmount ?? undefined,
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
      const kitchenPrintJob = await this.printJobsService.createPrintJob({
        organizationId: orgId,
        orderId: fullOrder.id,
        jobType: 'kitchen',
        payload: printPayload,
      });
      await this.printQueue.add('print-job', {
        orgId,
        type: 'kitchen',
        payload: printPayload,
        printJobId: kitchenPrintJob.id,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to enqueue updated kitchen ticket for order ${orderId}: ${message}`,
      );
    }

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
  async payOrder(
    user: CurrentUserPayload,
    orderId: string,
    paymentMethod: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const order = await this.getOrderByIdForOrg(orgId, orderId);
    if (order.paidAt) {
      throw new BadRequestException('This order has already been paid.');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('Cancelled orders cannot be paid.');
    }

    await this.db
      .update(schema.orders)
      .set({
        paymentMethod,
        paidAt: new Date(),
        status: order.status === 'pending' ? 'confirmed' : order.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    void this.auditService.log({
      action: 'order.paid',
      userId: user.id,
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      newValue: { paymentMethod, totalAmount: fullOrder.totalAmount },
    });

    this.eventsGateway.emitToOrganization(orgId, 'order.updated', fullOrder);
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

    const kitchenJob = await this.printQueue.add('print-job', {
      orgId,
      type: 'kitchen',
      payload: printPayload,
      printerId,
      printJobId: kitchenPrintJob.id,
    });

    const receiptJob = await this.printQueue.add('print-job', {
      orgId,
      type: 'receipt',
      payload: printPayload,
      printerId,
      printJobId: receiptPrintJob.id,
    });

    this.logger.log(
      `Queued print jobs for order ${fullOrder.id}: kitchen=${kitchenPrintJob.id}, receipt=${receiptPrintJob.id}`,
    );

    return {
      success: true,
      message: 'Print jobs enqueued successfully.',
      kitchenJobId: kitchenJob.id,
      receiptJobId: receiptJob.id,
    };
  }
}
