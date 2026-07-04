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
import { eq, and, isNull } from 'drizzle-orm';
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
   * Sends a restart command to the printer via its MQTT control topic.
   * Control topic: `restaurant/{orgId}/printer/{printerId}/control`
   */
  async restartPrinter(id: string, organizationId: string) {
    const printer = await this.verifyOwnership(id, organizationId);

    const controlTopic = `restaurant/${organizationId}/printer/${id}/control`;

    // HSPOS Cloud Printers often expect a JSON payload for reboot on their main or control topic
    const restartPayload = {
      command: 'reboot',
      cmd: 'reboot',
      action: 'restart',
      printerId: id,
      ts: new Date().toISOString(),
    };

    const topicsToPublish = [controlTopic];
    if (printer.topic) {
      topicsToPublish.push(printer.topic);
      topicsToPublish.push(`${printer.topic}/control`);
      topicsToPublish.push(`${printer.topic}/request`);
    }

    let anyPublished = false;
    for (const topic of topicsToPublish) {
      const published = await this.mqttService.publish(topic, restartPayload);
      if (published) anyPublished = true;
      this.logger.log(
        `Restart command sent to printer ${id} via topic ${topic} (published: ${published}).`,
      );
    }

    return { sent: anyPublished, topics: topicsToPublish };
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
