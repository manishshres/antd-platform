import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';
import { PrintJobsService } from '../printers/print-jobs.service';

/** The shape returned by OrdersService.getOrderByIdForOrg — used to type print payloads. */
export type FullOrder = {
  id: string;
  locationId: string | null;
  fireMode?: string;
  ticketNumber: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  subtotal: number | null;
  taxAmount: number | null;
  tipAmount: number | null;
  discountAmount: number | null;
  discountName: string | null;
  totalAmount: number;
  orderType: string | null;
  specialInstructions: string | null;
  paidAt: Date | null;
  createdAt: Date;
  items: {
    menuItemName: string;
    quantity: number;
    price: number;
    modifiers: unknown;
    notes: string | null;
    course?: number | null;
    firedAt?: Date | null;
  }[];
};

@Injectable()
export class OrderPrintService {
  private readonly logger = new Logger(OrderPrintService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly printJobsService: PrintJobsService,
  ) {}

  /**
   * Per-location printing policy as an event matrix: each document type (kitchen
   * ticket, customer receipt) declares which order events trigger it — save
   * (creation), update (unpaid edit), paid — plus a copy count (1–5).
   * Legacy enable/hold settings are normalized into the matrix.
   */
  async getPrintPlan(locationId: string | null | undefined) {
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
    ): {
      onSave: boolean;
      onUpdate: boolean;
      onPaid: boolean;
      copies: number;
    } => {
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

  /**
   * Build the printable representation of an order for either document type.
   * `opts.course` narrows it to a single course for a fire ticket; without it
   * the payload is exactly what it has always been.
   */
  buildPrintPayload(
    fullOrder: FullOrder,
    opts: { updated?: boolean; course?: number } = {},
  ) {
    const items =
      opts.course === undefined
        ? fullOrder.items
        : fullOrder.items.filter((i) => i.course === opts.course);
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
      course: opts.course,
      items: items.map((item) => ({
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        price: item.price,
        modifiers: item.modifiers ?? undefined,
        notes: item.notes ?? undefined,
        course: item.course ?? undefined,
      })),
      createdAt: fullOrder.createdAt,
    };
  }

  /**
   * Enqueue every document whose matrix row is checked for any of the given
   * events. A document prints at most once per call even when several of its
   * events fire together (e.g. a POS order created already-paid = save + paid).
   */
  async printForEvents(
    orgId: string,
    fullOrder: FullOrder,
    events: ('save' | 'update' | 'paid')[],
    opts: { updated?: boolean } = {},
  ) {
    try {
      const plan = await this.getPrintPlan(fullOrder.locationId);
      const payload = this.buildPrintPayload(fullOrder, opts);
      for (const jobType of ['kitchen', 'receipt'] as const) {
        // A coursed order's food reaches the kitchen through explicit fires,
        // never through save/update — otherwise the whole order (dessert
        // included) would print the moment the tab opens. The receipt is
        // unaffected: the guest is still billed for everything at once.
        if (jobType === 'kitchen' && fullOrder.fireMode === 'by_course') {
          continue;
        }
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
   * Enqueue the kitchen ticket for a single course.
   *
   * Deliberately ignores the event matrix from `getPrintPlan`: firing is an
   * explicit instruction from the register, so it prints regardless of the
   * location's save/update/paid checkboxes. Copies still honour the matrix.
   */
  async printCourse(orgId: string, fullOrder: FullOrder, course: number) {
    try {
      const plan = await this.getPrintPlan(fullOrder.locationId);
      const payload = this.buildPrintPayload(fullOrder, { course });
      if (payload.items.length === 0) return;
      for (let copy = 0; copy < plan.kitchen.copies; copy++) {
        await this.printJobsService.createPrintJob({
          organizationId: orgId,
          orderId: fullOrder.id,
          jobType: 'kitchen',
          payload,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to enqueue course ${course} ticket for order ${fullOrder.id}: ${msg}`,
      );
    }
  }

  /** Enqueue a manual print for both kitchen and receipt. */
  async printOrder(orgId: string, fullOrder: FullOrder, printerId?: string) {
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
}
