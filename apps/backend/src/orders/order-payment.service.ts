import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { AdjustOrderItemsDto } from './dto/adjust-order-items.dto';
import { AuditService } from '../common/services/audit.service';
import { UsersService } from '../users/users.service';
import { EventsGateway } from '../events/events.gateway';
import { OrderPricingService } from './order-pricing.service';
import { OrderPrintService, FullOrder } from './order-print.service';

@Injectable()
export class OrderPaymentService {
  private readonly logger = new Logger(OrderPaymentService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
    private readonly eventsGateway: EventsGateway,
    private readonly pricingService: OrderPricingService,
    private readonly printService: OrderPrintService,
  ) {}

  /** Sum of payments already recorded against an order (cents). */
  async paidSumFor(orderId: string): Promise<number> {
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
   *
   * The caller supplies a `getFullOrder` callback so we avoid a circular import
   * back to OrdersService.
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
    getFullOrder: (orgId: string, orderId: string) => Promise<FullOrder>,
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const order = await getFullOrder(orgId, orderId);
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

    const fullOrder = await getFullOrder(orgId, orderId);

    if (coversTotal) {
      await this.printService.printForEvents(orgId, fullOrder, ['paid']);
    }

    this.auditService.fireAndForget({
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
    tipAmount: number | undefined,
    getFullOrder: (orgId: string, orderId: string) => Promise<FullOrder>,
  ) {
    // recordPayment handles printing, audit, and realtime events.
    const { order: fullOrder } = await this.recordPayment(
      user,
      orderId,
      { method: paymentMethod, tipAmount },
      getFullOrder,
    );
    return fullOrder;
  }

  async refundPaidOrder(
    user: CurrentUserPayload,
    orderId: string,
    managerPin: string,
    reason?: string,
  ): Promise<unknown> {
    const orgId = await this.billingService.getRequiredOrg(user);

    // 1. Verify manager PIN
    const manager = await this.usersService.verifyManagerPin(orgId, managerPin);
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
          eq(schema.orders.organizationId, orgId),
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
        organizationId: orgId,
        userId: manager.id,
        action: 'order.refunded',
        entityType: 'order',
        entityId: order.id,
        newValue: {
          orderId: order.id,
          originalTotal: order.totalAmount,
          reason,
        },
      });
    });

    this.eventsGateway.emitToOrganization(orgId, 'order.updated', {
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
    const orgId = await this.billingService.getRequiredOrg(user);

    const manager = await this.usersService.verifyManagerPin(
      orgId,
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
          eq(schema.orders.organizationId, orgId),
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
        organizationId: orgId,
        userId: manager.id,
        action: 'order.refund_partial',
        entityType: 'order',
        entityId: order.id,
        newValue: { amount: dto.amount, reason: dto.reason },
      });
    });

    return {
      success: true,
      message: `Refunded $${(dto.amount / 100).toFixed(2)}`,
    };
  }

  async adjustOrderItems(
    user: CurrentUserPayload,
    orderId: string,
    dto: AdjustOrderItemsDto,
  ): Promise<unknown> {
    const orgId = await this.billingService.getRequiredOrg(user);

    const manager = await this.usersService.verifyManagerPin(
      orgId,
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
          eq(schema.orders.organizationId, orgId),
        ),
      )
      .limit(1);

    const order = orderRes[0];
    if (!order) throw new NotFoundException('Order not found.');

    const oldItemsRes = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    const { resolvedItems, subtotal: newSubtotal } =
      await this.pricingService.priceCartItems(orgId, dto.items);

    // In a full implementation we would recalculate tax, discount, tip perfectly.
    // For now, we adjust total by the subtotal difference.
    const oldSubtotal = oldItemsRes.reduce(
      (acc, i) => acc + i.price * i.quantity,
      0,
    );
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
      await tx
        .delete(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id));
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
        organizationId: orgId,
        userId: manager.id,
        action: 'order.adjust_items',
        entityType: 'order',
        entityId: order.id,
        previousValue: { items: oldItemsRes, totalAmount: order.totalAmount },
        newValue: {
          items: dto.items,
          totalAmount: newTotal,
          reason: dto.reason,
          balanceDiff,
        },
      });
    });

    this.eventsGateway.emitToOrganization(orgId, 'order.updated', {
      id: order.id,
      status: order.status,
    });

    return {
      success: true,
      message:
        balanceDiff < 0
          ? `Adjusted. Refunded $${(Math.abs(balanceDiff) / 100).toFixed(2)}.`
          : 'Items adjusted.',
      newTotal,
      balanceDiff,
    };
  }
}
