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
import { eq, and, inArray, count, isNull, desc } from 'drizzle-orm';
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
  }) {
    return this.createOrderForOrg(
      payload.orgId,
      payload.customerName,
      payload.customerPhone,
      payload.items,
    );
  }

  async createOrderForOrg(
    orgId: string,
    customerName: string,
    customerPhone: string,
    items: { menuItemId: string; quantity: number }[],
    userId?: string,
    locationId?: string,
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

    // Insert order and items within a transaction
    const orderId = await this.db.transaction(async (tx) => {
      const newOrders = await tx
        .insert(schema.orders)
        .values({
          organizationId: orgId,
          locationId: resolvedLocationId,
          customerName,
          customerPhone,
          status: 'pending',
          totalAmount,
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

    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    // Format print job payload
    const printPayload = {
      orderId: fullOrder.id,
      customerName: fullOrder.customerName,
      customerPhone: fullOrder.customerPhone,
      totalAmount: fullOrder.totalAmount,
      items: fullOrder.items.map((item) => ({
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        price: item.price,
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
      newValue: { totalAmount, items: resolvedItems, status: 'pending' },
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

  async updateOrderStatus(user: CurrentUserPayload, orderId: string, status: string) {
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

  async printOrder(user: CurrentUserPayload, orderId: string, printerId?: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const fullOrder = await this.getOrderByIdForOrg(orgId, orderId);

    const printPayload = {
      orderId: fullOrder.id,
      customerName: fullOrder.customerName,
      customerPhone: fullOrder.customerPhone,
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
