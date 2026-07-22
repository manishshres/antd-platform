import type { LocalOrder, PosSettings } from '../types';
import { buildKitchenTicketLines } from './receiptFormatter';
import { groupItemsByStation } from './stationRouting';
import { printLines } from './printerService';
import * as printQueueRepo from '../db/printQueueRepo';

/**
 * Background kitchen-print queue.
 *
 * Printing is a side effect of an order, never a gate on it. `Send` enqueues one
 * durable job per station and returns immediately; this service drains the queue
 * out of band. A dead printer leaves a `failed` job (surfaced as a badge on the
 * order) instead of blocking the register or losing the ticket — the job stays
 * put for auto-retry or a manual reprint.
 *
 * Bluetooth prints are strictly serial: two `connect()`s to different printers
 * at once wedge the adapter, so a single in-flight guard processes one job at a
 * time regardless of how many callers poke it.
 */

const MAX_ATTEMPTS = 5;

type Listener = (failedCount: number) => void;

class PrintQueueService {
  private running = false;
  private rerun = false;
  private listeners = new Set<Listener>();

  /** Notified with the current failed-job count after each drain — drives the
   *  header badge without every screen polling SQLite. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(printQueueRepo.failedCount());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const n = printQueueRepo.failedCount();
    for (const fn of this.listeners) fn(n);
  }

  /**
   * Split an order into per-station tickets and enqueue them. Returns the job
   * count so the caller can tell the cashier what was queued. Does not wait for
   * printing.
   */
  enqueueOrder(
    order: LocalOrder,
    settings: PosSettings,
    employeeName: string | null,
    businessName: string,
  ): number {
    const groups = groupItemsByStation(order.items);
    let queued = 0;
    for (const group of groups) {
      if (group.items.length === 0) continue;
      const stationName = group.station?.name ?? 'Kitchen';
      const target = group.station?.printerTarget ?? settings.printerTarget;
      const lines = buildKitchenTicketLines(order, settings.printerCharsPerLine, {
        items: group.items,
        stationName: group.station ? stationName : undefined,
        businessName,
        employeeName,
      });
      printQueueRepo.enqueue({ orderId: order.id, stationName, target, lines });
      queued += 1;
    }
    this.emit();
    void this.process(settings);
    return queued;
  }

  /**
   * Drain queued + failed jobs. Coalesces concurrent calls: a request that
   * arrives mid-drain sets a flag so one more pass runs afterwards, catching
   * jobs enqueued during the current pass.
   */
  async process(settings: PosSettings): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const jobs = printQueueRepo.claimable();
        for (const job of jobs) {
          if (!job.target) {
            printQueueRepo.markStatus(job.id, 'failed', {
              incrementAttempts: true,
              error: `No printer paired for ${job.stationName}.`,
            });
            continue;
          }
          if (job.attempts >= MAX_ATTEMPTS) {
            // Leave it 'failed' for a manual reprint rather than spin forever.
            continue;
          }
          const lines = printQueueRepo.linesFor(job.id);
          if (!lines) {
            printQueueRepo.markStatus(job.id, 'failed', {
              incrementAttempts: true,
              error: 'Ticket data was lost; reprint from the order.',
            });
            continue;
          }
          printQueueRepo.markStatus(job.id, 'printing');
          // eslint-disable-next-line no-await-in-loop -- serial by hardware constraint
          const result = await printLines(lines, settings, job.target);
          printQueueRepo.markStatus(job.id, result.ok ? 'printed' : 'failed', {
            incrementAttempts: true,
            error: result.ok ? null : (result.error ?? 'Print failed'),
          });
        }
      } while (this.rerun);
    } finally {
      this.running = false;
      this.emit();
    }
  }

  /** After a cold start, reclaim jobs stuck mid-print, then drain. */
  recoverAndProcess(settings: PosSettings): void {
    printQueueRepo.recoverStranded();
    this.emit();
    void this.process(settings);
  }

  /** Manual reprint of one failed ticket. */
  retryJob(jobId: string, settings: PosSettings): void {
    printQueueRepo.requeue(jobId);
    this.emit();
    void this.process(settings);
  }

  /** Retry every failed ticket — e.g. after paper is reloaded or the printer
   *  reconnects. Cheap to call opportunistically (foreground, sync). */
  retryAllFailed(settings: PosSettings): void {
    if (printQueueRepo.requeueAllFailed() > 0) {
      this.emit();
      void this.process(settings);
    }
  }
}

export const printQueue = new PrintQueueService();
