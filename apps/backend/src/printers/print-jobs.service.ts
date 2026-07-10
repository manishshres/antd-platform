import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventsGateway } from '../events/events.gateway';

export type PrintJobStatus = 'queued' | 'retrying' | 'sent' | 'failed';

/** Attempts at which a job is considered permanently dead-lettered */
const MAX_ATTEMPTS = 3;

@Injectable()
export class PrintJobsService {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('print-queue')
    private readonly printQueue: Queue,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async createPrintJob(options: {
    organizationId: string;
    orderId?: string;
    jobType: 'kitchen' | 'receipt' | 'report';
    printerId?: string;
    payload: Record<string, unknown>;
  }) {
    const [job] = await this.db
      .insert(schema.printJobs)
      .values({
        organizationId: options.organizationId,
        orderId: options.orderId || null,
        jobType: options.jobType,
        status: 'queued',
        printerId: options.printerId,
        attempts: 0,
        payload: options.payload,
      })
      .returning();

    this.eventsGateway.emitToOrganization(
      job.organizationId,
      'printJob.created',
      job,
    );

    // Enqueue the job for BullMQ processing
    await this.printQueue.add(
      'print-job',
      {
        orgId: job.organizationId,
        type: job.jobType,
        payload: job.payload,
        printerId: job.printerId,
        printJobId: job.id,
      },
      {
        jobId: job.id,
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    return job;
  }

  async getPrintJob(id: string) {
    const [job] = await this.db
      .select()
      .from(schema.printJobs)
      .where(eq(schema.printJobs.id, id))
      .limit(1);
    return job ?? null;
  }

  async updatePrintJobStatus(
    id: string,
    status: PrintJobStatus,
    options?: { attempts?: number; lastError?: string },
  ) {
    const updateValues: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (options?.attempts !== undefined) {
      updateValues.attempts = options.attempts;
    }
    if (options?.lastError !== undefined) {
      updateValues.lastError = options.lastError;
    }

    const [updated] = await this.db
      .update(schema.printJobs)
      .set(updateValues)
      .where(eq(schema.printJobs.id, id))
      .returning();

    if (updated) {
      this.eventsGateway.emitToOrganization(
        updated.organizationId,
        'printJob.updated',
        updated,
      );
    }
  }

  async listPrintJobs(
    organizationId: string,
    filters?: { status?: string; jobType?: string; printerId?: string },
  ) {
    const whereClauses = [eq(schema.printJobs.organizationId, organizationId)];

    if (filters?.status) {
      whereClauses.push(eq(schema.printJobs.status, filters.status));
    }
    if (filters?.jobType) {
      whereClauses.push(eq(schema.printJobs.jobType, filters.jobType));
    }
    if (filters?.printerId) {
      whereClauses.push(eq(schema.printJobs.printerId, filters.printerId));
    }

    return this.db
      .select()
      .from(schema.printJobs)
      .where(and(...whereClauses))
      .orderBy(schema.printJobs.createdAt);
  }

  async listOrderPrintJobs(
    organizationId: string,
    orderId: string,
    filters?: { status?: string; jobType?: string },
  ) {
    const whereClauses = [
      eq(schema.printJobs.organizationId, organizationId),
      eq(schema.printJobs.orderId, orderId),
    ];

    if (filters?.status) {
      whereClauses.push(eq(schema.printJobs.status, filters.status));
    }
    if (filters?.jobType) {
      whereClauses.push(eq(schema.printJobs.jobType, filters.jobType));
    }

    return this.db
      .select()
      .from(schema.printJobs)
      .where(and(...whereClauses))
      .orderBy(schema.printJobs.createdAt);
  }

  async getPrintJobById(id: string) {
    const result = await this.db
      .select()
      .from(schema.printJobs)
      .where(eq(schema.printJobs.id, id))
      .limit(1);

    return result[0];
  }

  async getOrganizationPrintJobById(organizationId: string, id: string) {
    const result = await this.db
      .select()
      .from(schema.printJobs)
      .where(
        and(
          eq(schema.printJobs.id, id),
          eq(schema.printJobs.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!result[0]) {
      throw new Error('Print job not found.');
    }

    return result[0];
  }

  /**
   * Returns all permanently failed (dead-letter) print jobs for an organization.
   * A job is dead-lettered when status = 'failed' and attempts >= MAX_ATTEMPTS.
   */
  async getDeadLetterJobs(organizationId: string) {
    const jobs = await this.listPrintJobs(organizationId, { status: 'failed' });
    return jobs.filter((j) => (j.attempts ?? 0) >= MAX_ATTEMPTS);
  }

  /**
   * Requeues a dead-lettered print job back onto the BullMQ print-queue.
   * Resets attempt count and status to 'queued'.
   */
  async requeueJob(jobId: string, organizationId: string) {
    const [job] = await this.db
      .select()
      .from(schema.printJobs)
      .where(
        and(
          eq(schema.printJobs.id, jobId),
          eq(schema.printJobs.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!job) {
      throw new NotFoundException('Print job not found.');
    }

    // Reset status and attempts
    await this.db
      .update(schema.printJobs)
      .set({
        status: 'queued',
        attempts: 0,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.printJobs.id, jobId));

    // Re-add to BullMQ queue
    const payload = job.payload as Record<string, unknown>;
    await this.printQueue.add('print-job', {
      orgId: organizationId,
      type: job.jobType,
      payload,
      printerId: job.printerId ?? undefined,
      printJobId: job.id,
    });

    this.logger.log(
      `Print job ${jobId} requeued for organization ${organizationId}.`,
    );

    return { success: true, jobId };
  }
}
