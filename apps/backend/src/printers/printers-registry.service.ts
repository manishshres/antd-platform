import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { MqttService } from './mqtt.service';
import { PrintJobsService } from './print-jobs.service';
import { CreatePrinterDto } from './dto/create-printer.dto';
import { UpdatePrinterDto } from './dto/update-printer.dto';
import { count } from 'drizzle-orm';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { notDeleted } from '../database/db.utils';

@Injectable()
export class PrintersRegistryService {
  private readonly logger = new Logger(PrintersRegistryService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly mqttService: MqttService,
    private readonly printJobsService: PrintJobsService,
  ) {}

  async listPrinters(
    organizationId: string,
    pagination: PaginationDto,
    locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { offset = 0, limit = 20 } = pagination;

    const whereClause = locationId
      ? and(
          eq(schema.printers.organizationId, organizationId),
          eq(schema.printers.locationId, locationId),
          notDeleted(schema.printers),
        )
      : and(
          eq(schema.printers.organizationId, organizationId),
          notDeleted(schema.printers),
        );

    const data = await this.db
      .select()
      .from(schema.printers)
      .where(whereClause)
      .orderBy(schema.printers.createdAt)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.printers)
      .where(whereClause);

    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }

  async getPrinter(id: string, organizationId: string) {
    return this.verifyOwnership(id, organizationId);
  }

  async createPrinter(organizationId: string, dto: CreatePrinterDto) {
    const [printer] = await this.db
      .insert(schema.printers)
      .values({
        organizationId,
        locationId: dto.locationId,
        name: dto.name,
        topic: dto.topic,
        type: dto.type,
        locationName: dto.locationName ?? null,
        ipAddress: dto.ipAddress ?? null,
        model: dto.model ?? null,
        notes: dto.notes ?? null,
        isOnline: false,
      })
      .returning();

    this.logger.log(
      `Printer "${dto.name}" (${dto.type}) registered for org ${organizationId}.`,
    );
    return printer;
  }

  async updatePrinter(
    id: string,
    organizationId: string,
    dto: UpdatePrinterDto,
  ) {
    await this.verifyOwnership(id, organizationId);

    const [updated] = await this.db
      .update(schema.printers)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.locationName !== undefined
          ? { locationName: dto.locationName }
          : {}),
        ...(dto.ipAddress !== undefined ? { ipAddress: dto.ipAddress } : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.printers.id, id))
      .returning();

    this.logger.log(`Printer ${id} updated for org ${organizationId}.`);
    return updated;
  }

  async deletePrinter(id: string, organizationId: string) {
    await this.verifyOwnership(id, organizationId);

    await this.db
      .update(schema.printers)
      .set({ deletedAt: new Date(), isOnline: false, updatedAt: new Date() })
      .where(eq(schema.printers.id, id));

    this.logger.log(`Printer ${id} soft-deleted for org ${organizationId}.`);
    return { success: true };
  }

  /**
   * Sends a test ESC/POS print job to the printer via MQTT.
   */
  async testPrint(id: string, organizationId: string) {
    const printer = await this.verifyOwnership(id, organizationId);

    // Create a real queue job so it appears in the UI and gets
    // processed by the print queue processor with full HSPOS formatting
    await this.printJobsService.createPrintJob({
      organizationId,
      jobType: printer.type === 'kitchen' ? 'kitchen' : 'receipt',
      printerId: id,
      payload: {
        orderId: `test-${Date.now()}`,
        createdAt: new Date().toISOString(),
        totalAmount: 0,
        items: [
          {
            menuItemId: 'test',
            menuItemName: `TEST PRINT for ${printer.name}`,
            quantity: 1,
            price: 0,
          },
        ],
      },
    });

    return { queued: true, printerName: printer.name, topic: printer.topic };
  }

  /**
   * Resets the printer. These devices consume raw ESC/POS bytes on their print topic —
   * a JSON payload there is not a command (it gets ignored, or printed as garbage text).
   * ESC @ (1B 40, "initialize printer") is the standard reset: it clears the buffer and
   * restores default state, which recovers most hangs. A true firmware reboot is not part
   * of ESC/POS; vendor-specific control channels can be layered in per model later.
   */
  async restartPrinter(id: string, organizationId: string) {
    const printer = await this.verifyOwnership(id, organizationId);

    const resetBytes = Buffer.from([0x1b, 0x40]); // ESC @
    const published = printer.topic
      ? await this.mqttService.publish(printer.topic, resetBytes)
      : false;

    // Also notify the platform control topic in case the device firmware listens there.
    const controlTopic = `restaurant/${organizationId}/printer/${id}/control`;
    await this.mqttService.publish(controlTopic, {
      command: 'reboot',
      printerId: id,
      ts: new Date().toISOString(),
    });

    this.logger.log(
      `Reset (ESC @) sent to printer ${id} via topic ${printer.topic} (published: ${published}).`,
    );
    return { sent: published, topic: printer.topic };
  }

  /**
   * Lists all print jobs (pending, sent, failed) for a specific printer.
   */
  async getPrinterQueue(
    id: string,
    organizationId: string,
    filters?: { status?: string },
  ) {
    await this.verifyOwnership(id, organizationId);

    return this.printJobsService.listPrintJobs(organizationId, {
      ...filters,
      printerId: id,
    });
  }

  /**
   * Retries a specific failed print job on the given printer.
   */
  async reprintJob(printerId: string, jobId: string, organizationId: string) {
    await this.verifyOwnership(printerId, organizationId);
    return this.printJobsService.requeueJob(jobId, organizationId);
  }

  private async verifyOwnership(id: string, organizationId: string) {
    const [printer] = await this.db
      .select()
      .from(schema.printers)
      .where(and(eq(schema.printers.id, id), notDeleted(schema.printers)))
      .limit(1);

    if (!printer) {
      throw new NotFoundException(`Printer ${id} not found.`);
    }
    if (printer.organizationId !== organizationId) {
      throw new ForbiddenException(
        'Printer does not belong to your organization.',
      );
    }
    return printer;
  }
}
