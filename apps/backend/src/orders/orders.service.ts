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
import { OrderReportDto, PrintOrderReportDto } from './dto/order-report.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { AdjustOrderItemsDto } from './dto/adjust-order-items.dto';
import { PrintJobsService } from '../printers/print-jobs.service';
import { AuditService } from '../common/services/audit.service';
import { EventsGateway } from '../events/events.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MANUAL_ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  type OrderStatus,
} from '../common/constants/order-status';
import { OrderPricingService } from './order-pricing.service';
import { OrderPrintService } from './order-print.service';
import { OrderPaymentService } from './order-payment.service';
import {
  startOfBusinessDay,
  endOfBusinessDay,
  DEFAULT_TIMEZONE,
} from '../common/time/business-day';

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
    if (dateFrom || dateTo) {
      // Bound the range by the location's business day, not the server's — see
      // startOfBusinessDay (P2-008). Without a location we fall back to the
      // platform default zone.
      const timezone = locationId
        ? await this.pricingService.getLocationTimezone(locationId)
        : DEFAULT_TIMEZONE;
      if (dateFrom) {
        conditions.push(
          gte(schema.orders.createdAt, startOfBusinessDay(dateFrom, timezone)),
        );
      }
      if (dateTo) {
        conditions.push(
          lte(schema.orders.createdAt, endOfBusinessDay(dateTo, timezone)),
        );
      }
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

    // "Today" and any explicit range are the location's business day (P2-008/P2-025).
    const timezone = await this.pricingService.getLocationTimezone(locationId);
    const start = startOfBusinessDay(dateFrom ?? new Date(), timezone);
    const end = endOfBusinessDay(dateTo ?? new Date(), timezone);

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

  /**
   * Business report over a date range: a time series bucketed by day/week/month
   * plus breakdowns. Sales = paid, non-cancelled order totals. Refunds = voided
   * (cancelled) order totals PLUS partial refunds, which live as negative rows
   * in the payments table rather than on the order.
   */
  async getOrderReport(user: CurrentUserPayload, dto: OrderReportDto) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const granularity = dto.granularity ?? 'day';

    // Range bounds follow the location's business day, not the server's (P2-008).
    const timezone = await this.pricingService.getLocationTimezone(
      dto.locationId,
    );
    const start = startOfBusinessDay(dto.dateFrom ?? new Date(), timezone);
    const end = endOfBusinessDay(dto.dateTo ?? new Date(), timezone);

    const scope = and(
      eq(schema.orders.organizationId, orgId),
      eq(schema.orders.locationId, dto.locationId),
      isNull(schema.orders.deletedAt),
      gte(schema.orders.createdAt, start),
      lte(schema.orders.createdAt, end),
    );

    // granularity is IsIn-whitelisted ('day'|'week'|'month'), so raw interpolation
    // is safe — and required: a bound parameter would make the SELECT and GROUP BY
    // copies of this expression distinct placeholders, which Postgres rejects.
    const bucket = sql<string>`to_char(date_trunc(${sql.raw(`'${granularity}'`)}, ${schema.orders.createdAt}), 'YYYY-MM-DD')`;
    const isSale = sql`${schema.orders.paidAt} is not null and ${schema.orders.status} <> 'cancelled'`;
    const isVoid = sql`${schema.orders.status} = 'cancelled'`;

    const buckets = await this.db
      .select({
        period: bucket,
        orders: sql<number>`count(*) filter (where ${isSale})`.mapWith(Number),
        sales:
          sql<number>`coalesce(sum(${schema.orders.totalAmount}) filter (where ${isSale}), 0)`.mapWith(
            Number,
          ),
        refunds:
          sql<number>`coalesce(sum(${schema.orders.totalAmount}) filter (where ${isVoid}), 0)`.mapWith(
            Number,
          ),
        refundCount: sql<number>`count(*) filter (where ${isVoid})`.mapWith(
          Number,
        ),
      })
      .from(schema.orders)
      .where(scope)
      .groupBy(bucket)
      .orderBy(bucket);

    // Partial refunds: negative payment rows against orders in the same scope.
    const paymentBucket = sql<string>`to_char(date_trunc(${sql.raw(`'${granularity}'`)}, ${schema.payments.createdAt}), 'YYYY-MM-DD')`;
    const partialRefunds = await this.db
      .select({
        period: paymentBucket,
        amount:
          sql<number>`coalesce(abs(sum(${schema.payments.amount})), 0)`.mapWith(
            Number,
          ),
        count: count().mapWith(Number),
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.payments.organizationId, orgId),
          eq(schema.orders.locationId, dto.locationId),
          sql`${schema.payments.amount} < 0`,
          // Cancelled orders are already counted whole via isVoid above.
          sql`${schema.orders.status} <> 'cancelled'`,
          gte(schema.payments.createdAt, start),
          lte(schema.payments.createdAt, end),
        ),
      )
      .groupBy(paymentBucket);

    // Merge partial refunds into their buckets (a bucket may exist only here,
    // e.g. a refund issued in a period with no new orders).
    const byPeriod = new Map(buckets.map((b) => [b.period, { ...b }]));
    for (const p of partialRefunds) {
      const b = byPeriod.get(p.period) ?? {
        period: p.period,
        orders: 0,
        sales: 0,
        refunds: 0,
        refundCount: 0,
      };
      b.refunds += p.amount;
      b.refundCount += p.count;
      byPeriod.set(p.period, b);
    }
    const series = [...byPeriod.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    const [byType, bySource, topItems] = await Promise.all([
      this.db
        .select({
          orderType: schema.orders.orderType,
          orders: sql<number>`count(*)`.mapWith(Number),
          sales:
            sql<number>`coalesce(sum(${schema.orders.totalAmount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.orders)
        .where(and(scope, sql`${isSale}`))
        .groupBy(schema.orders.orderType),
      this.db
        .select({
          source: schema.orders.source,
          orders: sql<number>`count(*)`.mapWith(Number),
          sales:
            sql<number>`coalesce(sum(${schema.orders.totalAmount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.orders)
        .where(and(scope, sql`${isSale}`))
        .groupBy(schema.orders.source),
      this.db
        .select({
          menuItemId: schema.orderItems.menuItemId,
          name: schema.menuItems.name,
          quantity: sql<number>`sum(${schema.orderItems.quantity})`.mapWith(
            Number,
          ),
          sales:
            sql<number>`coalesce(sum(${schema.orderItems.price} * ${schema.orderItems.quantity}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.orderItems)
        .innerJoin(
          schema.orders,
          eq(schema.orderItems.orderId, schema.orders.id),
        )
        .innerJoin(
          schema.menuItems,
          eq(schema.orderItems.menuItemId, schema.menuItems.id),
        )
        .where(and(scope, sql`${isSale}`))
        .groupBy(schema.orderItems.menuItemId, schema.menuItems.name)
        .orderBy(
          sql`sum(${schema.orderItems.price} * ${schema.orderItems.quantity}) desc`,
        )
        .limit(10),
    ]);

    const totals = series.reduce(
      (acc, b) => ({
        orders: acc.orders + b.orders,
        sales: acc.sales + b.sales,
        refunds: acc.refunds + b.refunds,
        refundCount: acc.refundCount + b.refundCount,
      }),
      { orders: 0, sales: 0, refunds: 0, refundCount: 0 },
    );

    return {
      granularity,
      dateFrom: start.toISOString(),
      dateTo: end.toISOString(),
      totals: {
        ...totals,
        netSales: totals.sales - totals.refunds,
        avgOrder:
          totals.orders > 0 ? Math.round(totals.sales / totals.orders) : 0,
      },
      series,
      byType,
      bySource,
      topItems,
    };
  }

  /**
   * Print the sales report to the receipt printer via the standard print
   * queue (jobType 'report'), so it gets retry handling and job history.
   */
  async printOrderReport(user: CurrentUserPayload, dto: PrintOrderReportDto) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const report = await this.getOrderReport(user, dto);

    const payload = {
      reportId: `report-${Date.now()}`,
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
      granularity: report.granularity,
      totals: report.totals,
      byType: report.byType,
      bySource: report.bySource,
      topItems: report.topItems.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        sales: i.sales,
      })),
    };

    const job = await this.printJobsService.createPrintJob({
      organizationId: orgId,
      jobType: 'report',
      printerId: dto.printerId,
      payload,
    });

    await this.auditService.log({
      organizationId: orgId,
      userId: user.id,
      action: 'order.report_printed',
      entityType: 'print_job',
      entityId: job.id,
      newValue: { dateFrom: report.dateFrom, dateTo: report.dateTo },
    });

    return { message: 'Report sent to printer.', printJobId: job.id };
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

    // Fetch order items and join with menu item details. leftJoin (not inner):
    // an order's own line items (quantity/price already snapshotted at order
    // time) must never disappear from its history just because the menu item
    // they reference was later removed — an inner join silently dropped the
    // whole row in that case.
    const itemsRes = (
      await this.db
        .select({
          id: schema.orderItems.id,
          quantity: schema.orderItems.quantity,
          price: schema.orderItems.price,
          modifiers: schema.orderItems.modifiers,
          notes: schema.orderItems.notes,
          course: schema.orderItems.course,
          firedAt: schema.orderItems.firedAt,
          menuItemId: schema.orderItems.menuItemId,
          menuItemName: schema.menuItems.name,
        })
        .from(schema.orderItems)
        .leftJoin(
          schema.menuItems,
          eq(schema.orderItems.menuItemId, schema.menuItems.id),
        )
        .where(eq(schema.orderItems.orderId, orderId))
    ).map((item) => ({
      ...item,
      menuItemName: item.menuItemName ?? 'Item no longer on menu',
    }));

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
    locationId?: string | null;
    customerName: string;
    customerPhone: string;
    items: { menuItemId: string; quantity: number; modifiers?: string[] }[];
    orderType?: string;
    specialInstructions?: string;
  }) {
    const order = await this.createOrderForOrg(
      payload.orgId,
      payload.customerName,
      payload.customerPhone,
      payload.items,
      undefined,
      payload.locationId ?? undefined,
      payload.orderType,
      payload.specialInstructions,
    );

    // Auto-start: the location can opt into sending AI orders straight to the kitchen
    // instead of parking them in 'pending' for someone to accept. Applied after creation
    // so the order's own listeners (printing, realtime) still see it come into being.
    if (payload.locationId && order?.id) {
      const [location] = await this.db
        .select({ autoStart: schema.locations.autoStartAiOrders })
        .from(schema.locations)
        .where(eq(schema.locations.id, payload.locationId))
        .limit(1);

      if (location?.autoStart) {
        const [started] = await this.db
          .update(schema.orders)
          .set({ status: 'preparing', updatedAt: new Date() })
          .where(eq(schema.orders.id, order.id))
          .returning();

        this.logger.log(
          `Auto-started AI order ${order.id} for location ${payload.locationId}.`,
        );
        return started ?? order;
      }
    }

    return order;
  }

  /**
   * Create a native Coneeko order imported from a delivery marketplace (via the
   * aggregator). Unlike the POS/AI paths, prices are NOT recomputed — the marketplace
   * already charged the customer, so we persist its amounts verbatim. Line items must
   * arrive pre-resolved to Coneeko menu items (the aggregator maps them via
   * menu_provider_mappings); modifiers are already in the POS snapshot shape.
   *
   * Idempotent on clientOrderId (`"{provider}:{externalOrderId}"`), backed by the
   * orders unique constraint, so a re-delivered webhook returns the existing order.
   * Reuses the shared side-effect pipeline (kitchen print, audit, usage, websocket +
   * `order.created`) so marketplace orders behave exactly like any other new order.
   */
  async createMarketplaceOrder(params: {
    organizationId: string;
    locationId: string | null;
    source: string;
    sourceId: string | null;
    integrationAccountId: string;
    externalOrderId: string;
    clientOrderId: string;
    customerName: string;
    customerPhone: string;
    orderType?: string | null;
    specialInstructions?: string | null;
    subtotal?: number | null;
    taxAmount?: number | null;
    tipAmount?: number | null;
    totalAmount: number;
    items: {
      menuItemId: string;
      quantity: number;
      price: number;
      modifiers?: unknown;
      notes?: string | null;
    }[];
  }) {
    const orgId = params.organizationId;

    if (params.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    // Idempotent replay: a re-delivered marketplace webhook returns the existing order.
    const replayed = await this.findByClientOrderId(
      orgId,
      params.clientOrderId,
    );
    if (replayed) {
      return replayed;
    }

    let orderId: string;
    try {
      orderId = await this.db.transaction(async (tx) => {
        const ticketNumber = params.locationId
          ? await this.pricingService.nextTicketNumber(tx, params.locationId)
          : null;

        const newOrders = await tx
          .insert(schema.orders)
          .values({
            organizationId: orgId,
            locationId: params.locationId,
            customerName: params.customerName,
            customerPhone: params.customerPhone,
            status: 'pending',
            subtotal: params.subtotal ?? null,
            taxAmount: params.taxAmount ?? null,
            tipAmount: params.tipAmount ?? null,
            totalAmount: params.totalAmount,
            orderType: params.orderType ?? null,
            specialInstructions: params.specialInstructions ?? null,
            source: params.source,
            sourceId: params.sourceId,
            integrationAccountId: params.integrationAccountId,
            externalOrderId: params.externalOrderId,
            ticketNumber,
            clientOrderId: params.clientOrderId,
          })
          .returning();

        const order = newOrders[0];
        if (!order) {
          throw new BadRequestException('Failed to create marketplace order.');
        }

        await tx.insert(schema.orderItems).values(
          params.items.map((item) => ({
            orderId: order.id,
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            price: item.price,
            modifiers: item.modifiers ?? null,
            notes: item.notes ?? null,
          })),
        );

        return order.id;
      });
    } catch (err) {
      // A concurrent re-delivery can race between the replay check and the insert;
      // the unique constraint is the backstop — return the winner's order.
      const winner = await this.replayOnClientOrderIdConflict(
        err,
        orgId,
        params.clientOrderId,
      );
      if (winner) {
        return winner;
      }
      throw err;
    }

    return this.dispatchOrderSideEffects(orgId, orderId, undefined, {
      totalAmount: params.totalAmount,
      items: params.items,
      status: 'pending',
      source: params.source,
      externalOrderId: params.externalOrderId,
    });
  }

  /**
   * Apply a status change originating from a marketplace (via the aggregator). The
   * caller is expected to have validated the transition with
   * OrderStatusTransitionService; this method performs the write and fires the same
   * `order.updated` event + websocket broadcast as the interactive path. Kept separate
   * from updateOrderStatus (which is user/POS-scoped with its own vocabulary) and free
   * of any aggregator dependency to avoid a circular module reference.
   */
  async updateStatusForAggregator(
    orgId: string,
    orderId: string,
    newStatus: string,
  ) {
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

    if (orderRes.length === 0) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const previousStatus = orderRes[0].status;
    if (previousStatus === newStatus) {
      return this.getOrderByIdForOrg(orgId, orderId);
    }

    await this.db
      .update(schema.orders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    this.auditService.fireAndForget({
      action: 'order.status_update',
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      previousValue: { status: previousStatus },
      newValue: { status: newStatus, via: 'aggregator' },
    });

    const updatedOrder = await this.getOrderByIdForOrg(orgId, orderId);
    this.eventsGateway.emitToOrganization(orgId, 'order.updated', updatedOrder);
    this.eventEmitter.emit('order.updated', { orgId, updatedOrder });

    return updatedOrder;
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
    clientOrderId?: string,
  ) {
    if (items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    // Idempotent replay: a retried request with the same clientOrderId returns
    // the order it already created instead of inserting a duplicate.
    if (clientOrderId) {
      const replayed = await this.findByClientOrderId(orgId, clientOrderId);
      if (replayed) {
        return replayed;
      }
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
    let orderId: string;
    try {
      orderId = await this.db.transaction(async (tx) => {
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
            clientOrderId: clientOrderId ?? null,
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
    } catch (err) {
      // A concurrent retry can slip between the replay check and the insert;
      // the unique constraint is the backstop — return the winner's order.
      const replayed = clientOrderId
        ? await this.replayOnClientOrderIdConflict(err, orgId, clientOrderId)
        : null;
      if (replayed) {
        return replayed;
      }
      throw err;
    }

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
      /** Opt in to the location's configured auto-gratuity/service-charge rate. */
      applyServiceCharge?: boolean;
      /** Loyalty points to redeem, 1 point = 1 cent off. Requires customerId. */
      redeemPoints?: number;
      discountId?: string;
      promoCode?: string;
      clientOrderId?: string;
      /** 'by_course' holds the kitchen ticket until each course is fired. */
      fireMode?: string;
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
      const replayed = await this.findByClientOrderId(orgId, dto.clientOrderId);
      if (replayed) {
        return replayed;
      }
    }

    // Validate the location belongs to this org and pick up its tax rate.
    const [location] = await this.db
      .select({
        id: schema.locations.id,
        taxRateBps: schema.locations.taxRateBps,
        serviceChargeBps: schema.locations.serviceChargeBps,
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
    let customerLoyaltyPoints = 0;
    if (dto.customerId) {
      await this.pricingService.requireOrgCustomer(orgId, dto.customerId);
      if (dto.redeemPoints) {
        const [customerRow] = await this.db
          .select({ loyaltyPoints: schema.customers.loyaltyPoints })
          .from(schema.customers)
          .where(eq(schema.customers.id, dto.customerId))
          .limit(1);
        customerLoyaltyPoints = customerRow?.loyaltyPoints ?? 0;
      }
    }
    const redeemPoints = Math.max(0, Math.round(dto.redeemPoints ?? 0));
    if (redeemPoints > 0) {
      if (!dto.customerId) {
        throw new BadRequestException(
          'A linked customer is required to redeem loyalty points.',
        );
      }
      if (redeemPoints > customerLoyaltyPoints) {
        throw new BadRequestException(
          `Customer only has ${customerLoyaltyPoints} loyalty points.`,
        );
      }
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
    // Discount reduces the taxable and exempt portions proportionally, mirroring how it's
    // already applied to the whole subtotal above.
    const taxableSubtotal = this.pricingService.taxableSubtotal(resolvedItems);
    const taxableAfterDiscount =
      subtotal > 0
        ? taxableSubtotal - (discountAmount * taxableSubtotal) / subtotal
        : 0;
    // Service charge is computed off the discounted taxable base, same as tax, and — unlike
    // tip — is itself taxable, matching how mandatory gratuities are commonly treated.
    const serviceChargeAmount = dto.applyServiceCharge
      ? Math.round((taxableBase * location.serviceChargeBps) / 10000)
      : 0;
    const taxAmount = Math.round(
      ((taxableAfterDiscount + serviceChargeAmount) * location.taxRateBps) /
        10000,
    );
    const tipAmount = Math.max(0, Math.round(dto.tipAmount ?? 0));
    const preRedemptionTotal =
      taxableBase + serviceChargeAmount + taxAmount + tipAmount;
    // Redemption is a payment offset (like store credit), not a pre-tax price cut, so it's
    // subtracted after tax and floored at 0 rather than folded into the taxable base.
    const redemptionAmount = Math.min(redeemPoints, preRedemptionTotal);
    const totalAmount = preRedemptionTotal - redemptionAmount;
    // Earn only accrues on orders paid at creation — pay-later orders don't accrue until
    // that gap is closed (see the class-level note on this method).
    const loyaltyPointsEarned = dto.paymentMethod
      ? Math.floor(totalAmount / 100)
      : 0;

    const now = new Date();
    let orderId: string;
    try {
      orderId = await this.db.transaction(async (tx) => {
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
            serviceChargeAmount,
            loyaltyPointsEarned: loyaltyPointsEarned || null,
            loyaltyPointsRedeemed: redemptionAmount || null,
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
            fireMode: dto.fireMode === 'by_course' ? 'by_course' : 'all',
          })
          .returning();

        if (!order) {
          throw new BadRequestException('Failed to create order.');
        }

        const byCourse = dto.fireMode === 'by_course';
        await tx.insert(schema.orderItems).values(
          resolvedItems.map((item) => ({
            orderId: order.id,
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            price: item.price,
            modifiers: item.modifiers,
            notes: item.notes,
            course: item.course,
            // Course 1 goes to the kitchen the moment the party is seated —
            // starters don't wait for a server to tap Fire.
            firedAt: byCourse && item.course === 1 ? now : null,
          })),
        );

        await this.pricingService.decrementStock(tx, resolvedItems);

        if (
          dto.customerId &&
          (redemptionAmount > 0 || loyaltyPointsEarned > 0)
        ) {
          await tx
            .update(schema.customers)
            .set({
              loyaltyPoints: sql`GREATEST(${schema.customers.loyaltyPoints} - ${redemptionAmount} + ${loyaltyPointsEarned}, 0)`,
              updatedAt: now,
            })
            .where(eq(schema.customers.id, dto.customerId));
        }

        if (resolvedItems.some((i) => i.priceOverridden)) {
          this.auditService.fireAndForget({
            action: 'order.item.price_override',
            userId: user.id,
            organizationId: orgId,
            entityType: 'order',
            entityId: order.id,
            newValue: {
              items: resolvedItems
                .filter((i) => i.priceOverridden)
                .map((i) => ({
                  menuItemId: i.menuItemId,
                  price: i.price,
                  reason: i.priceOverrideReason,
                })),
            },
          });
        }

        return order.id;
      });
    } catch (err) {
      // A concurrent retry can slip between the replay check and the insert;
      // the unique constraint is the backstop — return the winner's order.
      const replayed = dto.clientOrderId
        ? await this.replayOnClientOrderIdConflict(
            err,
            orgId,
            dto.clientOrderId,
          )
        : null;
      if (replayed) {
        return replayed;
      }
      throw err;
    }

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

  /**
   * Append items to an open tab (POS dine-in). Delta semantics on purpose:
   * `updateOrderItems` replaces the whole line set, so two registers ringing
   * into the same tab would silently drop each other's items. Here the client
   * sends only what it added and the read-concat-write happens server-side
   * under an advisory lock.
   *
   * The lock key is 'order-payment' — the same one OrderPaymentService takes —
   * so an append can never interleave with a payment on the same order. A
   * separate 'order-items' key would serialize appends against each other but
   * still let one race a tender and re-price an order mid-payment.
   */
  async appendOrderItems(
    user: CurrentUserPayload,
    orderId: string,
    dto: {
      clientMutationId?: string;
      items: {
        menuItemId: string;
        quantity: number;
        optionIds?: string[];
        notes?: string;
        course?: number;
        priceOverride?: number;
        priceOverrideReason?: string;
      }[];
    },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    if (dto.items.length === 0) {
      throw new BadRequestException('No items to append.');
    }

    const replayed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('order-payment'), hashtext(${orderId}))`,
      );

      // Claim the idempotency key first: a retry after a dropped response must
      // be a no-op, and the unique constraint — not this check — is what makes
      // that true under concurrency.
      if (dto.clientMutationId) {
        const claimed = await tx
          .insert(schema.orderMutations)
          .values({
            organizationId: orgId,
            orderId,
            clientMutationId: dto.clientMutationId,
            kind: 'append',
          })
          .onConflictDoNothing()
          .returning({ id: schema.orderMutations.id });
        if (claimed.length === 0) return true;
      }

      // Post-lock re-read: the order may have been paid or cancelled while we
      // waited for the lock.
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, orderId),
            eq(schema.orders.organizationId, orgId),
            isNull(schema.orders.deletedAt),
          ),
        )
        .limit(1);
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
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
      if ((await this.paymentService.paidSumFor(orderId, tx)) > 0) {
        throw new BadRequestException(
          'Orders with recorded payments cannot be edited.',
        );
      }

      const { resolvedItems, subtotal: addedSubtotal } =
        await this.pricingService.priceCartItems(orgId, dto.items);

      // Existing lines keep their original prices — a menu price change must
      // never retroactively re-price what the guest already ordered.
      const existing = await tx
        .select({
          price: schema.orderItems.price,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
      const existingSubtotal = existing.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0,
      );

      const subtotal = existingSubtotal + addedSubtotal;
      const taxRateBps = await this.pricingService.getTaxRate(order.locationId);
      // Re-resolve the order's own discount so a percent discount keeps
      // scaling as the tab grows.
      const discount = await this.pricingService.resolveDiscount(orgId, user, {
        discountId: order.discountId ?? undefined,
      });
      const discountAmount = this.pricingService.discountAmountFor(
        discount,
        subtotal,
      );
      const taxableBase = subtotal - discountAmount;
      const taxAmount = Math.round((taxableBase * taxRateBps) / 10000);
      const totalAmount = taxableBase + taxAmount + (order.tipAmount ?? 0);

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

      await this.pricingService.decrementStock(tx, resolvedItems);

      await tx
        .update(schema.orders)
        .set({
          subtotal,
          taxAmount,
          discountAmount,
          discountName: discount?.name ?? null,
          totalAmount,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      return false;
    });

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);
    if (replayed) return fullOrder;

    // Fire the added lines to the kitchen; an open tab prints as it grows.
    await this.printService.printForEvents(orgId, fullOrder, ['update'], {
      updated: true,
    });

    this.auditService.fireAndForget({
      action: 'order.items.append',
      userId: user.id,
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      newValue: { appended: dto.items, totalAmount: fullOrder.totalAmount },
    });

    this.eventsGateway.emitToOrganization(orgId, 'order.updated', fullOrder);
    return fullOrder;
  }

  /**
   * Send one course of a coursed order to the kitchen.
   *
   * Shares the 'order-payment' advisory lock with appends and tenders so a fire
   * can never interleave with either — the ticket must reflect the lines that
   * are actually on the order at that instant.
   *
   * Re-firing a course with nothing left unfired is a deliberate no-op rather
   * than an error: a double-tapped Fire button must not double-print, but it
   * also shouldn't show the server a scary failure.
   */
  async fireCourse(
    user: CurrentUserPayload,
    orderId: string,
    dto: { course: number; clientMutationId?: string },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    const fired = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('order-payment'), hashtext(${orderId}))`,
      );

      if (dto.clientMutationId) {
        const claimed = await tx
          .insert(schema.orderMutations)
          .values({
            organizationId: orgId,
            orderId,
            clientMutationId: dto.clientMutationId,
            kind: 'fire',
          })
          .onConflictDoNothing()
          .returning({ id: schema.orderMutations.id });
        if (claimed.length === 0) return false;
      }

      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.id, orderId),
            eq(schema.orders.organizationId, orgId),
            isNull(schema.orders.deletedAt),
          ),
        )
        .limit(1);
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      if (order.paidAt) {
        throw new BadRequestException(
          'This order is already paid; there is nothing left to fire.',
        );
      }
      if (!['pending', 'confirmed'].includes(order.status)) {
        throw new BadRequestException(
          `Orders in status "${order.status}" can no longer be fired.`,
        );
      }

      const stamped = await tx
        .update(schema.orderItems)
        .set({ firedAt: new Date() })
        .where(
          and(
            eq(schema.orderItems.orderId, orderId),
            eq(schema.orderItems.course, dto.course),
            isNull(schema.orderItems.firedAt),
          ),
        )
        .returning({ id: schema.orderItems.id });

      return stamped.length > 0;
    });

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);
    if (!fired) return fullOrder;

    await this.printService.printCourse(orgId, fullOrder, dto.course);

    this.auditService.fireAndForget({
      action: 'order.course.fire',
      userId: user.id,
      organizationId: orgId,
      entityType: 'order',
      entityId: orderId,
      newValue: { course: dto.course },
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

    if (!MANUAL_ORDER_STATUSES.includes(status as OrderStatus)) {
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

    const currentStatus = orderRes[0].status as OrderStatus;
    const allowedNextStatuses = ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];

    if (!allowedNextStatuses.includes(status as OrderStatus)) {
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
    idempotencyKey?: string,
  ) {
    return this.paymentService.refundPartialOrder(
      user,
      orderId,
      dto,
      idempotencyKey,
    );
  }

  async adjustOrderItems(
    user: CurrentUserPayload,
    orderId: string,
    dto: AdjustOrderItemsDto,
  ) {
    return this.paymentService.adjustOrderItems(user, orderId, dto);
  }

  // ---------------------------------------------------------------------------
  // Idempotency (clientOrderId) helpers shared by the creation paths
  // ---------------------------------------------------------------------------

  /** The already-created order for a client key, or null if this key is new. */
  private async findByClientOrderId(orgId: string, clientOrderId: string) {
    const [existing] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, orgId),
          eq(schema.orders.clientOrderId, clientOrderId),
        ),
      )
      .limit(1);
    return existing ? this.getOrderByIdForOrg(orgId, existing.id) : null;
  }

  /**
   * When an insert lost the race on the (organizationId, clientOrderId) unique
   * constraint, fetch and return the order the concurrent request created.
   * Returns null for any other error so the caller rethrows.
   */
  private async replayOnClientOrderIdConflict(
    err: unknown,
    orgId: string,
    clientOrderId: string,
  ) {
    const isUniqueViolation = [err, (err as { cause?: unknown })?.cause].some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        (e as { code?: string }).code === '23505' &&
        String((e as { constraint?: string }).constraint ?? '').includes(
          'idx_orders_org_client_id',
        ),
    );
    if (!isUniqueViolation) {
      return null;
    }
    return this.findByClientOrderId(orgId, clientOrderId);
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

    // printForEvents deliberately withholds the kitchen ticket for a coursed
    // order. Course 1 still goes out now — the starters are what the party is
    // waiting on — and the rest wait for an explicit fire.
    if (fullOrder.fireMode === 'by_course') {
      await this.printService.printCourse(orgId, fullOrder, 1);
    }

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
      this.analyticsService
        .recordUsage(orgId, fullOrder.locationId, 'order_volume', 1, {
          orderId: fullOrder.id,
        })
        .catch((err: unknown) => {
          this.logger.error(
            `Failed to record usage for order ${fullOrder.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
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
