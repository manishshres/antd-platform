import { Injectable, Logger, Inject } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { EscPosBuilder, MARGIN_DOTS, PRINT_AREA_DOTS } from './escpos-builder';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and } from 'drizzle-orm';

/** 1 Apps, 2 Mains, 3 Dessert — the fixed course set the register offers. */
export const COURSE_LABELS: Record<number, string> = {
  1: 'APPETIZERS',
  2: 'MAINS',
  3: 'DESSERT',
};

const MAX_PRINT_PACKET_BYTES = 16378;

export interface PrintJobPayload {
  orderId: string;
  ticketNumber?: number;
  updated?: boolean;
  /** Set when this ticket is one fired course rather than the whole order. */
  course?: number;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  items: {
    menuItemName: string;
    quantity: number;
    price: number;
    /** Modifier snapshot: {modifier, option, priceAdjustment} objects. */
    modifiers?: { modifier?: string; option?: string }[] | null;
    notes?: string | null;
    course?: number;
  }[];
  createdAt: Date;
  printerId?: string;
}

/** Sales-report ticket printed on the receipt printer (jobType 'report'). */
export interface SalesReportPrintPayload {
  /** Synthetic id used as the printer packet ticket id. */
  reportId: string;
  dateFrom: string; // ISO
  dateTo: string; // ISO
  granularity: 'day' | 'week' | 'month';
  totals: {
    orders: number;
    sales: number;
    refunds: number;
    refundCount: number;
    netSales: number;
    avgOrder: number;
  };
  byType: { orderType: string | null; orders: number; sales: number }[];
  bySource: { source: string | null; orders: number; sales: number }[];
  topItems: { name: string; quantity: number; sales: number }[];
}

@Injectable()
export class PrinterService {
  private readonly logger = new Logger(PrinterService.name);

  constructor(
    private readonly mqttService: MqttService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  private buildPrinterPacket(orderId: string, content: Buffer): Buffer {
    const flagHeader = Buffer.from([0x03]);
    const defaultTopic = Buffer.from([0x00]);
    const ticketId = Buffer.from(orderId, 'ascii');
    const ticketTerminator = Buffer.from([0x00]);
    const packet = Buffer.concat([
      flagHeader,
      defaultTopic,
      ticketId,
      ticketTerminator,
      content,
    ]);

    if (packet.length > MAX_PRINT_PACKET_BYTES) {
      throw new Error(
        `Print packet length ${packet.length} exceeds printer limit ${MAX_PRINT_PACKET_BYTES}. ` +
          'Reduce receipt content or split the job.',
      );
    }

    return packet;
  }

  private formatCustomerReceipt(
    orgName: string,
    timezone: string,
    payload: PrintJobPayload,
  ): Buffer {
    const builder = new EscPosBuilder();
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(payload.createdAt));
    const formattedPrice = (priceCents: number) =>
      `$${(priceCents / 100).toFixed(2)}`;

    builder
      .init()
      .setPrintArea(MARGIN_DOTS, PRINT_AREA_DOTS)

      // Header
      .align('center')
      .bold(true)
      .size(2, 2)
      .line(orgName.toUpperCase())
      .size(1, 1)
      .bold(false)
      .line('Order Confirmation Receipt')
      .line('--------------------------------------------')

      // Order metadata
      .align('left')
      .line(`Order ID: ${payload.orderId.substring(0, 8)}...`)
      .line(`Customer: ${payload.customerName}`)
      .line(`Phone:    ${payload.customerPhone}`)
      .line(`Date:     ${dateStr}`)
      .rule()

      // Items list
      .bold(true)
      .row('Item Description', 'Amount')
      .bold(false)
      .rule();

    for (const item of payload.items) {
      builder.row(
        `${item.menuItemName} x${item.quantity}`,
        formattedPrice(item.price * item.quantity),
      );
    }

    builder
      .rule()
      // Total
      .bold(true)
      .row('TOTAL AMOUNT', formattedPrice(payload.totalAmount))
      .bold(false)
      .rule()

      // Footer
      .align('center')
      .line('Thank you for your order!')
      .line('Powered by Call Center AI')
      .feed(4)
      .cut();

    return builder.build();
  }

  private formatKitchenTicket(
    orgName: string,
    timezone: string,
    payload: PrintJobPayload,
  ): Buffer {
    const builder = new EscPosBuilder();
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(payload.createdAt));

    builder
      .init()
      .setPrintArea(MARGIN_DOTS, PRINT_AREA_DOTS)

      // Header
      .align('center')
      .bold(true)
      .size(2, 2)
      .line('KITCHEN TICKET')
      .size(1, 1)
      .bold(false)
      .line('--------------------------------------------')

      // Metadata
      .align('left')
      .line(`Restaurant: ${orgName}`)
      .line(
        `Order:      ${
          payload.ticketNumber != null
            ? `#${payload.ticketNumber}`
            : payload.orderId.substring(0, 8)
        }${payload.updated ? '  ** UPDATED **' : ''}`,
      )
      .line(`Customer:   ${payload.customerName}`)
      .line(`Time:       ${dateStr}`)
      .rule();

    // Course band — only on a fired-course ticket. An all-at-once ticket
    // renders byte-for-byte as it always has.
    if (payload.course != null) {
      builder
        .align('center')
        .bold(true)
        .size(2, 2)
        .line(`COURSE ${payload.course}`)
        .size(1, 1)
        .line(COURSE_LABELS[payload.course] ?? '')
        .size(1, 1)
        .bold(false)
        .align('left')
        .rule();
    }

    builder
      // Items List (Large items for readability in busy kitchen)
      .bold(true)
      .size(1, 2) // Normal width, double height
      .line('ITEMS TO PREPARE:')
      .line();

    for (const item of payload.items) {
      builder.line(`[ ] ${item.quantity} x ${item.menuItemName}`);
      // Modifier selections and per-item notes are prep instructions — the
      // kitchen must see "spicy" / "no onions", not just the item name.
      if (Array.isArray(item.modifiers)) {
        for (const mod of item.modifiers) {
          if (mod?.option) builder.line(`      + ${mod.option}`);
        }
      }
      if (item.notes) {
        builder.line(`      * ${item.notes}`);
      }
    }

    builder.size(1, 1).bold(false).rule().align('center').feed(4).cut();

    return builder.build();
  }

  private async loadOrganizationPrinterConfig(
    orgId: string,
    locationId?: string,
  ) {
    const orgRow = await this.db
      .select({
        name: schema.organizations.name,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);

    const org = orgRow[0];
    let timezone = 'America/New_York';

    if (locationId) {
      const [loc] = await this.db
        .select({ timezone: schema.locations.timezone })
        .from(schema.locations)
        .where(eq(schema.locations.id, locationId))
        .limit(1);
      if (loc && loc.timezone) {
        timezone = loc.timezone;
      }
    }

    const conditions = [eq(schema.printers.organizationId, orgId)];
    if (locationId) {
      conditions.push(eq(schema.printers.locationId, locationId));
    }

    const defaultPrinters = await this.db
      .select({
        topic: schema.printers.topic,
        name: schema.printers.name,
      })
      .from(schema.printers)
      .where(and(...conditions))
      .limit(1);

    const defaultPrinter = defaultPrinters[0];

    return {
      name: org?.name || 'Our Restaurant',
      timezone,
      printerTopic: defaultPrinter?.topic?.trim(),
      printerName: defaultPrinter?.name?.trim(),
    };
  }

  private buildTopic(orgId: string, type: 'kitchen' | 'receipt'): string {
    return `restaurant/${orgId}/${type}/print`;
  }

  private async resolvePrinterTopic(
    orgId: string,
    type: 'kitchen' | 'receipt',
    printerId?: string,
  ): Promise<string | undefined> {
    if (!printerId) {
      return undefined;
    }

    const normalized = printerId.trim();
    if (!normalized || normalized.toLowerCase() === 'print') {
      return undefined;
    }

    // Support full printer command topic IDs like Prn... as well as a
    // fallback printer-specific path under the restaurant namespace.
    if (normalized.startsWith('Prn') || normalized.includes('/')) {
      return normalized;
    }

    // If the printerId is a UUID, look up its actual topic in the database
    if (
      normalized.match(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      )
    ) {
      const [printer] = await this.db
        .select()
        .from(schema.printers)
        .where(eq(schema.printers.id, normalized))
        .limit(1);
      if (printer?.topic) {
        return printer.topic;
      }
    }

    return `restaurant/${orgId}/${type}/${normalized}`;
  }

  private async publishPrintPacket(
    orgId: string,
    type: 'kitchen' | 'receipt',
    packet: Buffer,
    printerTopic?: string,
    printJobId?: string,
  ): Promise<boolean> {
    // Publish to the device topic OR the org-type broadcast — never both. HSPOS
    // devices subscribe to both channels; a dual publish delivers the same ticket
    // twice, the device prints the first and reports Discard (8) for the duplicate,
    // and that late report used to downgrade an already-printed job to "failed".
    const printerSpecificTopic = await this.resolvePrinterTopic(
      orgId,
      type,
      printerTopic,
    );
    const topics = printerSpecificTopic
      ? [printerSpecificTopic]
      : [this.buildTopic(orgId, type)];

    // HSPOS Cloud Printer Packet Format:
    // [Flag (1 byte)] + [Reply Topic (N bytes + \x00)] + [Ticket (N bytes + \x00)] + [Data]
    // Flag 0x03 = Return success status to default topic (0x01) + Carry ticket number (0x02)
    // Empty reply topic (\x00) uses default receipt topic.
    let hsposHeader: Buffer;
    if (printJobId) {
      const ticketBuf = Buffer.from(printJobId + '\0', 'ascii');
      hsposHeader = Buffer.concat([Buffer.from([0x03, 0x00]), ticketBuf]);
    } else {
      hsposHeader = Buffer.from([0x01, 0x00, 0x00]);
    }
    const hsposPacket = Buffer.concat([hsposHeader, packet]);

    let anySuccess = false;
    this.logger.log(
      `Publishing ${hsposPacket.length} byte HSPOS print packet to MQTT topic(s): ${topics.join(', ')}`,
    );
    for (const topic of topics) {
      const success = await this.mqttService.publish(topic, hsposPacket);
      anySuccess = anySuccess || success;
      if (!success) {
        this.logger.warn(`Failed to publish print packet to topic: ${topic}`);
      }
    }

    return anySuccess;
  }

  async printKitchenTicket(
    orgId: string,
    payload: PrintJobPayload,
    printerTopic?: string,
    locationId?: string,
    printJobId?: string,
  ): Promise<boolean> {
    const {
      name: orgName,
      timezone,
      printerTopic: orgPrinterTopic,
    } = await this.loadOrganizationPrinterConfig(orgId, locationId);
    const activePrinterTopic = printerTopic?.trim() || orgPrinterTopic?.trim();
    const baseTopic = this.buildTopic(orgId, 'kitchen');
    this.logger.log(
      `Dispatching kitchen ticket print job for order ${payload.orderId} to base topic: ${baseTopic}`,
    );
    if (activePrinterTopic) {
      this.logger.log(
        `Using printerTopic="${activePrinterTopic}" for printer-specific kitchen topic`,
      );
    }

    const receiptBytes = this.formatKitchenTicket(orgName, timezone, payload);
    const packet = this.buildPrinterPacket(payload.orderId, receiptBytes);

    return this.publishPrintPacket(
      orgId,
      'kitchen',
      packet,
      activePrinterTopic,
      printJobId,
    );
  }

  async printCustomerReceipt(
    orgId: string,
    payload: PrintJobPayload,
    printerTopic?: string,
    locationId?: string,
    printJobId?: string,
  ): Promise<boolean> {
    const {
      name: orgName,
      timezone,
      printerTopic: orgPrinterTopic,
    } = await this.loadOrganizationPrinterConfig(orgId, locationId);
    const activePrinterTopic = printerTopic?.trim() || orgPrinterTopic?.trim();
    const baseTopic = this.buildTopic(orgId, 'receipt');
    this.logger.log(
      `Dispatching customer receipt print job for order ${payload.orderId} to base topic: ${baseTopic}`,
    );
    if (activePrinterTopic) {
      this.logger.log(
        `Using printerTopic="${activePrinterTopic}" for printer-specific receipt topic`,
      );
    }

    const receiptBytes = this.formatCustomerReceipt(orgName, timezone, payload);
    const packet = this.buildPrinterPacket(payload.orderId, receiptBytes);

    return this.publishPrintPacket(
      orgId,
      'receipt',
      packet,
      activePrinterTopic,
      printJobId,
    );
  }

  private formatSalesReport(
    orgName: string,
    timezone: string,
    payload: SalesReportPrintPayload,
  ): Buffer {
    const builder = new EscPosBuilder();
    const fmtDate = (iso: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'medium',
      }).format(new Date(iso));
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const typeLabel: Record<string, string> = {
      dine_in: 'Dine-in',
      pickup: 'Pickup',
      delivery: 'Delivery',
    };
    const sourceLabel: Record<string, string> = {
      pos: 'POS',
      ai_phone: 'AI Phone',
      web: 'Web',
    };

    builder
      .init()
      .setPrintArea(MARGIN_DOTS, PRINT_AREA_DOTS)
      .align('center')
      .bold(true)
      .size(2, 2)
      .line(orgName.toUpperCase())
      .size(1, 1)
      .line('SALES REPORT')
      .bold(false)
      .line(`${fmtDate(payload.dateFrom)} - ${fmtDate(payload.dateTo)}`)
      .rule()
      .align('left')
      .bold(true)
      .row('Orders', String(payload.totals.orders))
      .row('Gross Sales', money(payload.totals.sales))
      .row(
        `Refunds (${payload.totals.refundCount})`,
        `-${money(payload.totals.refunds)}`,
      )
      .row('NET SALES', money(payload.totals.netSales))
      .bold(false)
      .row('Avg Order', money(payload.totals.avgOrder))
      .rule();

    if (payload.byType.length > 0) {
      builder.bold(true).line('BY ORDER TYPE').bold(false);
      for (const t of payload.byType) {
        const label = t.orderType
          ? (typeLabel[t.orderType] ?? t.orderType)
          : 'Unknown';
        builder.row(`${label} x${t.orders}`, money(t.sales));
      }
      builder.rule();
    }

    if (payload.bySource.length > 0) {
      builder.bold(true).line('BY SOURCE').bold(false);
      for (const s of payload.bySource) {
        const label = s.source
          ? (sourceLabel[s.source] ?? s.source)
          : 'Unknown';
        builder.row(`${label} x${s.orders}`, money(s.sales));
      }
      builder.rule();
    }

    if (payload.topItems.length > 0) {
      builder.bold(true).line('TOP ITEMS').bold(false);
      for (const item of payload.topItems) {
        builder.row(`${item.name} x${item.quantity}`, money(item.sales));
      }
      builder.rule();
    }

    const printedAt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date());
    builder.align('center').line(`Printed ${printedAt}`).feed(4).cut();

    return builder.build();
  }

  /** Print a sales report to the receipt printer (default or explicit topic). */
  async printSalesReport(
    orgId: string,
    payload: SalesReportPrintPayload,
    printerTopic?: string,
    locationId?: string,
    printJobId?: string,
  ): Promise<boolean> {
    const {
      name: orgName,
      timezone,
      printerTopic: orgPrinterTopic,
    } = await this.loadOrganizationPrinterConfig(orgId, locationId);
    const activePrinterTopic = printerTopic?.trim() || orgPrinterTopic?.trim();

    const reportBytes = this.formatSalesReport(orgName, timezone, payload);
    const packet = this.buildPrinterPacket(payload.reportId, reportBytes);

    // Reports come out of the receipt printer — same topic family as receipts.
    return this.publishPrintPacket(
      orgId,
      'receipt',
      packet,
      activePrinterTopic,
      printJobId,
    );
  }
}
