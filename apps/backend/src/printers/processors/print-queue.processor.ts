import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrinterService, PrintJobPayload } from '../printer.service';
import { PrintJobsService } from '../print-jobs.service';

interface PrintJobData {
  orgId: string;
  type: 'kitchen' | 'receipt';
  payload: PrintJobPayload;
  printerId?: string;
  printJobId?: string;
}

@Processor('print-queue')
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
          payload,
          job.data.printerId,
          undefined, // locationId not needed here since we use printerId
          printJobId,
        );
      } else if (type === 'receipt') {
        success = await this.printerService.printCustomerReceipt(
          orgId,
          payload,
          job.data.printerId,
          undefined, // locationId not needed here
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

      return { success, type, orderId: payload.orderId };
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
