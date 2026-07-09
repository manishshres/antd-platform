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
import {
  eq,
  and,
  or,
  ilike,
  inArray,
  count,
  isNull,
  desc,
  gte,
  lte,
  sql,
} from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { GetOrdersDto } from './dto/get-orders.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { AdjustOrderItemsDto } from './dto/adjust-order-items.dto';
import { PrintJobsService } from '../printers/print-jobs.service';
import { AuditService } from '../common/services/audit.service';
import { EventsGateway } from '../events/events.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderPricingService } from './order-pricing.service';
import { OrderPrintService } from './order-print.service';
import { OrderPaymentService } from './order-payment.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    private readonly analyticsService: AnalyticsService,
    private readonly printJobsService: PrintJobsService,
    private readonly auditService: AuditService,
    private readonly eventsGateway: EventsGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly pricingService: OrderPricingService,
    private readonly printService: OrderPrintService,
    private readonly paymentService: OrderPaymentService,
  ) {}

  // ---------------------------------------------------------------------------
  // Query / CRUD
  // ---------------------------------------------------------------------------

  async getOrders(
    user: CurrentUserPayload,
    query: GetOrdersDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    // Resolve the org from the JWT context (a platform admin's selected org via ?orgId=). This
    // scopes the list to that org instead of returning every tenant's orders unfiltered.
    const orgId = await this.billingService.getRequiredOrg(user);

    const {
      offset = 0,
      limit = 20,
      locationId,
      status,
      q,
      dateFrom,
      dateTo,
    } = query;

    const conditions = [isNull(schema.orders.deletedAt)];
    if (orgId) conditions.push(eq(schema.orders.organizationId, orgId));
    if (locationId) conditions.push(eq(schema.orders.locationId, locationId));
    if (status) conditions.push(eq(schema.orders.status, status));

    // History search: ticket number ("47" or "#47"), customer name, or phone.
    if (q?.trim()) {
      const term = q.trim();
      const searchConds = [
        ilike(schema.orders.customerName, `%${term}%`),
        ilike(schema.orders.customerPhone, `%${term}%`),
      ];
      const ticketNo = Number(term.replace(/^#/, ''));
      if (Number.isInteger(ticketNo) && ticketNo > 0) {
        searchConds.push(eq(schema.orders.ticketNumber, ticketNo));
      }
      conditions.push(or(...searchConds)!);
    }
    if (dateFrom) {
      conditions.push(gte(schema.orders.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }

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

  /**
   * Header metrics for the POS Transactions hub, scoped to a location and a day:
   * open (unpaid) count + total, paid sales, and refunds (cancelled/refunded orders).
   */
  async getTransactionSummary(
    user: CurrentUserPayload,
    locationId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    const start = dateFrom ? new Date(dateFrom) : new Date();
    if (!dateFrom) start.setHours(0, 0, 0, 0);
    const end = dateTo ? new Date(dateTo) : new Date();
    end.setHours(23, 59, 59, 999);

    const scope = and(
      eq(schema.orders.organizationId, orgId),
      eq(schema.orders.locationId, locationId),
      isNull(schema.orders.deletedAt),
      gte(schema.orders.createdAt, start),
      lte(schema.orders.createdAt, end),
    );

    const [row] = await this.db
      .select({
        openCount:
          sql<number>`count(*) filter (where ${schema.orders.paidAt} is null and ${schema.orders.status} in ('pending','confirmed'))`.mapWith(
            Number,
          ),
        openTotal:
          sql<number>`coalesce(sum(${schema.orders.totalAmount}) filter (where ${schema.orders.paidAt} is null and ${schema.orders.status} in ('pending','confirmed')), 0)`.mapWith(
            Number,
          ),
        salesTotal:
          sql<number>`coalesce(sum(${schema.orders.totalAmount}) filter (where ${schema.orders.paidAt} is not null and ${schema.orders.status} <> 'cancelled'), 0)`.mapWith(
            Number,
          ),
        salesCount:
          sql<number>`count(*) filter (where ${schema.orders.paidAt} is not null and ${schema.orders.status} <> 'cancelled')`.mapWith(
            Number,
          ),
        refundTotal:
          sql<number>`coalesce(sum(${schema.orders.totalAmount}) filter (where ${schema.orders.status} = 'cancelled'), 0)`.mapWith(
            Number,
          ),
        refundCount:
          sql<number>`count(*) filter (where ${schema.orders.status} = 'cancelled')`.mapWith(
            Number,
          ),
      })
      .from(schema.orders)
      .where(scope);

    return (
      row ?? {
        openCount: 0,
        openTotal: 0,
        salesTotal: 0,
        salesCount: 0,
        refundTotal: 0,
        refundCount: 0,
      }
    );
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

    const paymentsRes = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));
    return {
      ...order,
      items: itemsRes,
      payments: paymentsRes,
    };
  }

  // ---------------------------------------------------------------------------
  // Order Creation
  // ---------------------------------------------------------------------------

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
    items: { menuItemId: string; quantity: number; modifiers?: string[] }[];
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
    items: { menuItemId: string; quantity: number; modifiers?: string[] }[],
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
      modifiers?: string[];
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
        modifiers: item.modifiers,
      });
    }

    // Resolve the owning location (H5): prefer an explicit hint, else the location carried by
    // the ordered items, else the org's single location. Persisted so location-scoped lists,
    // dashboards and usage billing include AI-generated orders.
    const resolvedLocationId = await this.pricingService.resolveOrderLocation(
      orgId,
      locationId,
      dbItems.map((i) => i.locationId),
    );

    // Apply the location's flat sales tax (basis points). Orders without a resolvable
    // location are charged tax-free rather than guessing a rate.
    const taxRateBps = await this.pricingService.getTaxRate(resolvedLocationId);
    const subtotal = totalAmount;
    const taxAmount = Math.round((subtotal * taxRateBps) / 10000);
    totalAmount = subtotal + taxAmount;

    // Insert order and items within a transaction
    const orderId = await this.db.transaction(async (tx) => {
      const ticketNumber = resolvedLocationId
        ? await this.pricingService.nextTicketNumber(tx, resolvedLocationId)
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
          // jsonb column — store the value directly (never pre-stringified), and in the
          // same snapshot shape as POS orders ({modifier, option, priceAdjustment}) so
          // the register, kitchen tickets, and reorder flows can all consume it. AI
          // free-text requests carry no price adjustment.
          modifiers: resItem.modifiers?.length
            ? resItem.modifiers.map((name) => ({
                modifier: 'Request',
                option: name,
                priceAdjustment: 0,
              }))
            : null,
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
   * Create an order from the in-store POS register. Prices items AND selected modifier options
   * server-side (never trusting client math), snapshots modifier selections onto the order items,
   * and records how the order was paid ('cash' | 'card' — detailed payment processing is a later
   * phase). POS orders are paid up front, so they enter the pipeline as 'confirmed'.
   */
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
      clientOrderId?: string;
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

    if (dto.clientOrderId) {
      const [existing] = await this.db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.organizationId, orgId),
            eq(schema.orders.clientOrderId, dto.clientOrderId),
          ),
        )
        .limit(1);

      if (existing) {
        return this.getOrderByIdForOrg(orgId, existing.id);
      }
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

    // A linked customer profile must belong to this org (never trust client ids).
    if (dto.customerId) {
      await this.pricingService.requireOrgCustomer(orgId, dto.customerId);
    }

    const { resolvedItems, subtotal } =
      await this.pricingService.priceCartItems(orgId, dto.items);

    // Discount reduces the taxable base; tax on the discounted subtotal; tip added after tax.
    const discount = await this.pricingService.resolveDiscount(
      orgId,
      user,
      dto,
    );
    const discountAmount = this.pricingService.discountAmountFor(
      discount,
      subtotal,
    );
    const taxableBase = subtotal - discountAmount;
    const taxAmount = Math.round((taxableBase * location.taxRateBps) / 10000);
    const tipAmount = Math.max(0, Math.round(dto.tipAmount ?? 0));
    const totalAmount = taxableBase + taxAmount + tipAmount;

    const now = new Date();
    const orderId = await this.db.transaction(async (tx) => {
      const ticketNumber = await this.pricingService.nextTicketNumber(
        tx,
        dto.locationId,
      );
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
          clientOrderId: dto.clientOrderId ?? null,
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

  // ---------------------------------------------------------------------------
  // Order Editing
  // ---------------------------------------------------------------------------

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
    if ((await this.paymentService.paidSumFor(orderId)) > 0) {
      throw new BadRequestException(
        'Orders with recorded payments cannot be edited.',
      );
    }

    if (dto.customerId) {
      await this.pricingService.requireOrgCustomer(orgId, dto.customerId);
    }

    const { resolvedItems, subtotal } =
      await this.pricingService.priceCartItems(orgId, dto.items);

    const taxRateBps = await this.pricingService.getTaxRate(order.locationId);

    // Same tender math as createPosOrder: discount → taxable base → tax; any tip already
    // recorded on the order is preserved (tips normally land at payment time).
    const discount = await this.pricingService.resolveDiscount(
      orgId,
      user,
      dto,
    );
    const discountAmount = this.pricingService.discountAmountFor(
      discount,
      subtotal,
    );
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
          ...(dto.customerId !== undefined
            ? { customerId: dto.customerId || null }
            : {}),
          ...(dto.tableId !== undefined
            ? { tableId: dto.tableId || null }
            : {}),
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
    await this.printService.printForEvents(orgId, fullOrder, ['update'], {
      updated: true,
    });

    this.auditService.fireAndForget({
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

  // ---------------------------------------------------------------------------
  // Status Transitions
  // ---------------------------------------------------------------------------

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

    this.auditService.fireAndForget({
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

  // ---------------------------------------------------------------------------
  // Print (delegates to OrderPrintService)
  // ---------------------------------------------------------------------------

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
    return this.printService.printOrder(orgId, fullOrder, printerId);
  }

  // ---------------------------------------------------------------------------
  // Payment (delegates to OrderPaymentService)
  // ---------------------------------------------------------------------------

  async recordPayment(
    user: CurrentUserPayload,
    orderId: string,
    dto: {
      method: string;
      amount?: number;
      cashReceived?: number;
      tipAmount?: number;
    },
  ) {
    return this.paymentService.recordPayment(
      user,
      orderId,
      dto,
      this.getOrderByIdForOrg.bind(this),
    );
  }

  async payOrder(
    user: CurrentUserPayload,
    orderId: string,
    paymentMethod: string,
    tipAmount?: number,
  ) {
    return this.paymentService.payOrder(
      user,
      orderId,
      paymentMethod,
      tipAmount,
      this.getOrderByIdForOrg.bind(this),
    );
  }

  async refundPaidOrder(
    user: CurrentUserPayload,
    orderId: string,
    managerPin: string,
    reason?: string,
  ) {
    return this.paymentService.refundPaidOrder(
      user,
      orderId,
      managerPin,
      reason,
    );
  }

  async refundPartialOrder(
    user: CurrentUserPayload,
    orderId: string,
    dto: PartialRefundDto,
  ) {
    return this.paymentService.refundPartialOrder(user, orderId, dto);
  }

  async adjustOrderItems(
    user: CurrentUserPayload,
    orderId: string,
    dto: AdjustOrderItemsDto,
  ) {
    return this.paymentService.adjustOrderItems(user, orderId, dto);
  }

  // ---------------------------------------------------------------------------
  // Side-effect dispatch (shared by all creation paths)
  // ---------------------------------------------------------------------------

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
    await this.printService.printForEvents(
      orgId,
      fullOrder,
      fullOrder.paidAt ? ['save', 'paid'] : ['save'],
    );

    this.auditService.fireAndForget({
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
}
