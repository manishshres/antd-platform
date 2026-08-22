import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  PrinterService,
  PrintJobPayload,
  SalesReportPrintPayload,
} from '../printer.service';
import { PrintJobsService } from '../print-jobs.service';
import { SHARED_WORKER_OPTIONS } from '../../queues/queues.module';

interface PrintJobData {
  orgId: string;
  type: 'kitchen' | 'receipt' | 'report';
  payload: PrintJobPayload | SalesReportPrintPayload;
  printerId?: string;
  printJobId?: string;
}

/**
 * Keeps the 30-second stalled sweep the other queues gave up. A kitchen ticket that dies
 * with its worker has to be reclaimed fast — five minutes is an order the kitchen never
 * sees. The extra sweep costs ~2.9k Redis commands a day, which is the trade being made
 * deliberately here and nowhere else.
 */
@Processor('print-queue', {
  ...SHARED_WORKER_OPTIONS,
  stalledInterval: 30_000,
})
export class PrintQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(PrintQueueProcessor.name);

  constructor(
    private readonly printerService: PrinterService,
    private readonly printJobsService: PrintJobsService,
  ) {
    super();
  }

  async process(job: Job<PrintJobData, any, string>): Promise<any> {
    this.logger.log(
      `Processing print job ${job.id} for organization ${job.data.orgId}...`,
    );

    const { orgId, type, payload, printJobId } = job.data;
    const attempts = (job.attemptsMade ?? 0) + 1;

    try {
      if (printJobId) {
        await this.printJobsService.updatePrintJobStatus(
          printJobId,
          'retrying',
          {
            attempts,
          },
        );
      }

      let success = false;
      if (type === 'kitchen') {
        success = await this.printerService.printKitchenTicket(
          orgId,
          payload as PrintJobPayload,
          job.data.printerId,
          undefined, // locationId not needed here since we use printerId
          printJobId,
        );
      } else if (type === 'receipt') {
        success = await this.printerService.printCustomerReceipt(
          orgId,
          payload as PrintJobPayload,
          job.data.printerId,
          undefined, // locationId not needed here
          printJobId,
        );
      } else if (type === 'report') {
        success = await this.printerService.printSalesReport(
          orgId,
          payload as SalesReportPrintPayload,
          job.data.printerId,
          undefined,
          printJobId,
        );
      } else {
        throw new Error(`Unknown print type: ${type as string}`);
      }

      if (!success) {
        this.logger.warn(
          `Print job ${job.id} dispatched but broker was unreachable (fallback used).`,
        );
        if (printJobId) {
          await this.printJobsService.updatePrintJobStatus(
            printJobId,
            'failed',
            {
              attempts,
              lastError: 'MQTT broker unreachable; buffered fallback used.',
            },
          );
        }
      } else {
        this.logger.log(`Print job ${job.id} processed successfully.`);
        if (printJobId) {
          await this.printJobsService.updatePrintJobStatus(printJobId, 'sent', {
            attempts,
          });
        }
      }

      return {
        success,
        type,
        orderId: 'orderId' in payload ? payload.orderId : payload.reportId,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Failed to process print job ${job.id}: ${message}`,
        stack,
      );
      if (printJobId) {
        await this.printJobsService.updatePrintJobStatus(printJobId, 'failed', {
          attempts,
          lastError: message,
        });
      }
      throw err; // Re-throw to trigger BullMQ retry logic
    }
  }
}
