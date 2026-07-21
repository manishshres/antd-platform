import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
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
import { IdempotencyService } from '../common/services/idempotency.service';
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
    private readonly idempotencyService: IdempotencyService,
    private readonly usersService: UsersService,
    private readonly eventsGateway: EventsGateway,
    private readonly pricingService: OrderPricingService,
    private readonly printService: OrderPrintService,
  ) {}

  /** Sum of payments already recorded against an order (cents). */
  async paidSumFor(
    orderId: string,
    db: Pick<NodePgDatabase<typeof schema>, 'select'> = this.db,
  ): Promise<number> {
    const [row] = await db
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
   * Serialize concurrent payment/refund writers for one order. Must run inside
   * the transaction that reads balances and writes payments — Postgres doesn't
   * allow FOR UPDATE on the SUM aggregates these flows depend on, so without
   * this two concurrent split-pays (or refunds) both read the same balance and
   * overpay/double-refund. Namespaced (two-arg form) so it can't collide with
   * the location lock nextTicketNumber takes.
   */
  private async lockOrderRow(
    tx: Pick<NodePgDatabase<typeof schema>, 'execute'>,
    orderId: string,
  ): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('order-payment'), hashtext(${orderId}))`,
    );
  }

  /** Load an org-scoped order row inside a transaction (post-lock re-read). */
  private async orderForUpdate(
    tx: Pick<NodePgDatabase<typeof schema>, 'select'>,
    orgId: string,
    orderId: string,
  ) {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    return order;
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
    // Fails fast (404) if the order doesn't exist or belongs to another org.
    await getFullOrder(orgId, orderId);

    // Every balance read and guard runs inside the serialized section — two
    // concurrent split-pays must not both observe the same remaining balance.
    const outcome = await this.db.transaction(async (tx) => {
      await this.lockOrderRow(tx, orderId);
      const order = await this.orderForUpdate(tx, orgId, orderId);
      if (order.paidAt) {
        throw new BadRequestException('This order has already been paid.');
      }
      if (order.status === 'cancelled') {
        throw new BadRequestException('Cancelled orders cannot be paid.');
      }

      const priorPaid = await this.paidSumFor(orderId, tx);
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

      // Which single method (or 'split') describes the order so far? Safe to
      // read here: the advisory lock serializes concurrent payment writers.
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

      return {
        applied,
        tip,
        cashReceived,
        changeGiven,
        coversTotal,
        remaining: newTotal - priorPaid - applied,
      };
    });

    const fullOrder = await getFullOrder(orgId, orderId);

    if (outcome.coversTotal) {
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
        applied: outcome.applied,
        tipAmount: outcome.tip,
        cashReceived: outcome.cashReceived,
        changeGiven: outcome.changeGiven,
        paid: outcome.coversTotal,
      },
    });
    this.eventsGateway.emitToOrganization(orgId, 'order.updated', fullOrder);

    return {
      applied: outcome.applied,
      changeGiven: outcome.changeGiven,
      remaining: outcome.remaining,
      paid: outcome.coversTotal,
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

    // 2. Guards, reads and writes run in one serialized transaction so two
    // concurrent refund requests can't both observe a refundable order and
    // double-refund it.
    await this.db.transaction(async (tx) => {
      await this.lockOrderRow(tx, orderId);
      const order = await this.orderForUpdate(tx, orgId, orderId);

      if (order.status === 'cancelled') {
        throw new BadRequestException('Order is already cancelled/refunded.');
      }
      if (!order.paidAt && !order.paymentMethod) {
        throw new BadRequestException('Order is not paid.');
      }

      const orderPayments = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id));

      // Net amount still refundable: positive payments minus refunds already
      // issued (including prior partial refunds). Never flip more than this.
      let remaining = orderPayments.reduce((acc, p) => acc + p.amount, 0);
      if (remaining <= 0) {
        throw new BadRequestException('Order has no refundable balance.');
      }

      await tx
        .update(schema.orders)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      const refundRows: (typeof schema.payments.$inferInsert)[] = [];
      for (const p of orderPayments) {
        if (p.amount <= 0 || remaining <= 0) {
          continue;
        }
        const amount = Math.min(p.amount, remaining);
        remaining -= amount;
        // Cash/tip details only mirror cleanly when the payment is refunded in
        // full; a partially-covered payment refunds principal only.
        const coversPayment = amount === p.amount;
        refundRows.push({
          organizationId: p.organizationId,
          locationId: p.locationId,
          orderId: p.orderId,
          method: p.method,
          amount: -amount,
          tipAmount: coversPayment ? -p.tipAmount : 0,
          cashReceived:
            coversPayment && p.cashReceived ? -p.cashReceived : null,
          changeGiven: coversPayment && p.changeGiven ? -p.changeGiven : null,
          createdBy: manager.id,
        });
      }
      if (refundRows.length > 0) {
        await tx.insert(schema.payments).values(refundRows);
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
      id: orderId,
      status: 'cancelled',
    });

    return { success: true, message: 'Order voided and refunded.' };
  }

  /**
   * Wrap a refund-partial op in an Idempotency-Key reservation if a key was
   * provided. On exception, the reservation is dropped so a retry can succeed.
   */
  private async withIdempotency<T>(
    scope: string,
    key: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key) return fn();
    const replay = await this.idempotencyService.replay<T>(scope, key);
    if (replay) return replay.body;
    const won = await this.idempotencyService.begin(scope, key);
    if (!won) {
      throw new ConflictException(
        'A refund with this Idempotency-Key is already in flight.',
      );
    }
    try {
      const result = await fn();
      await this.idempotencyService.complete(scope, key, 200, result);
      return result;
    } catch (err) {
      // Drop the in-flight reservation so the client can retry without
      // waiting 24 h for the TTL to expire. Failures (4xx validation,
      // 5xx internal) are NOT idempotency-replayable — fresh request.
      await this.idempotencyService.drop(scope, key);
      throw err;
    }
  }

  async refundPartialOrder(
    user: CurrentUserPayload,
    orderId: string,
    dto: PartialRefundDto,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const orgId = await this.billingService.getRequiredOrg(user);

    return this.withIdempotency('refund-partial', idempotencyKey, async () => {
      const manager = await this.usersService.verifyManagerPin(
        orgId,
        dto.managerPin,
      );
      if (!manager) {
        throw new ForbiddenException('Invalid manager PIN.');
      }

      await this.db.transaction(async (tx) => {
        // Guards and the balance read run after the lock: concurrent partial
        // refunds (retry / double-click) must not both pass the cap check.
        await this.lockOrderRow(tx, orderId);
        const order = await this.orderForUpdate(tx, orgId, orderId);
        if (order.status === 'cancelled') {
          throw new BadRequestException('Order is cancelled.');
        }
        if (!order.paidAt) {
          throw new BadRequestException('Order is not paid.');
        }

        // Cap the refund at what has actually been paid, net of any refunds
        // already issued — cumulative refunds can never exceed payments.
        const netPaid = await this.paidSumFor(order.id, tx);
        if (dto.amount > netPaid) {
          throw new BadRequestException(
            `Refund exceeds the remaining refundable balance of $${(netPaid / 100).toFixed(2)}.`,
          );
        }

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
    });
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

    // We pre-load the order here so we can answer the controller with the
    // existing discount/location context. Concurrent adjusts are serialized
    // below by lockOrderRow + a tx-local re-read.
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

    // P2-005 fix: full tender recompute on edit, not just the subtotal delta.
    // The order carries a snapshot of the discount that was applied at create
    // time. We re-evaluate that discount against the *new* subtotal so the
    // dollar amount follows the items; the discount id/name are preserved.
    // Tax is recomputed from the location's rate on (newSubtotal - newDiscount),
    // matching `createPosOrder`. Existing tip is preserved verbatim.
    const oldSubtotal = oldItemsRes.reduce(
      (acc, i) => acc + i.price * i.quantity,
      0,
    );

    const taxRateBps = await this.pricingService.getTaxRate(order.locationId);
    // P2-005: applied discounts are stored as a *fixed* dollar amount snapshot
    // on the order row. When items change, recompute tax against the new
    // (subtotal - discount) and preserve the original discount amount capped
    // at the new subtotal. Percent-based promos would have stored `discountId`
    // and `value` separately; current schema only carries amount, so we treat
    // it as fixed (the cashier's intent: "take $X off the bill").
    const discountSnapshot =
      order.discountAmount != null && order.discountAmount > 0
        ? { type: 'fixed' as const, value: order.discountAmount }
        : null;
    const newDiscountAmount = this.pricingService.discountAmountFor(
      discountSnapshot,
      newSubtotal,
    );
    const taxableBase = Math.max(0, newSubtotal - newDiscountAmount);
    const newTax = Math.round((taxableBase * taxRateBps) / 10000);
    const existingTip = order.tipAmount ?? 0;
    const newTotal = taxableBase + newTax + existingTip;
    const balanceDiff = newTotal - order.totalAmount;
    void oldSubtotal; // surfaced via audit only

    await this.db.transaction(async (tx) => {
      // Lock and re-read inside the tx so two concurrent adjusts serialize.
      await this.lockOrderRow(tx, order.id);
      const orderLocked = await this.orderForUpdate(tx, orgId, order.id);

      // If anything has changed about the order between pre-read and re-read
      // (status flip, a refund that landed), redo the math against the
      // authoritative row.
      const liveNetPaid = await this.paidSumFor(orderLocked.id, tx);
      const liveTip = orderLocked.tipAmount ?? 0;
      const liveStart = newSubtotal - newDiscountAmount;
      const liveTax = Math.round((liveStart * taxRateBps) / 10000);
      const liveTotal = Math.max(0, liveStart) + liveTax + liveTip;
      const liveBalance = Math.max(0, liveTotal - liveNetPaid);

      // 1. Update order totals; preserve the existing tip exactly.
      await tx
        .update(schema.orders)
        .set({
          subtotal: newSubtotal,
          discountAmount: newDiscountAmount,
          // `discountName` is a snapshot — keep the existing one if it was set.
          taxAmount: liveTax,
          totalAmount: liveTotal,
          updatedAt: new Date(),
          // Un-pay when the new total outpaces the amount paid; re-pay is
          // handled by the cashier via the payment flow, not here.
          paidAt:
            liveBalance > 0
              ? null
              : orderLocked.tipAmount != null
                ? orderLocked.paidAt
                : orderLocked.paidAt,
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

      // 3. Issue partial refund if the new total is less than what was paid.
      // The cap is the live `netPaid` so concurrent refunds/partials can't
      // double-issue — the same lock that serialized this adjust also
      // serialized other refund writers.
      if (liveTotal < liveNetPaid) {
        const refundAmt = Math.min(liveNetPaid, liveNetPaid - liveTotal);
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
        previousValue: {
          items: oldItemsRes,
          totalAmount: order.totalAmount,
        },
        newValue: {
          items: dto.items,
          totalAmount: liveTotal,
          subtotal: newSubtotal,
          discountAmount: newDiscountAmount,
          taxAmount: liveTax,
          reason: dto.reason,
          balanceDiff: liveTotal - order.totalAmount,
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
