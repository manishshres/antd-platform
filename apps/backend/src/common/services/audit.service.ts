import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';

export interface AuditLogOptions {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  previousValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Log an audit event.
   * Runs asynchronously in the background and catches errors to prevent blocking main requests.
   */
  async log(options: AuditLogOptions): Promise<void> {
    try {
      this.logger.log(
        `Audit Log — Action: ${options.action}, User: ${options.userId ?? 'system'}`,
      );

      await this.db.insert(schema.auditLogs).values({
        organizationId: options.organizationId || null,
        userId: options.userId || null,
        action: options.action,
        entityType: options.entityType || null,
        entityId: options.entityId || null,
        previousValue: options.previousValue || null,
        newValue: options.newValue || null,
        ipAddress: options.ipAddress || null,
        userAgent: options.userAgent || null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to write audit log: ${msg}`);
    }
  }

  /**
   * Fire-and-forget wrapper: logs the entry without awaiting or blocking the caller.
   * Always catches and logs errors internally — never throws to the caller.
   * Replaces the `void this.auditService.log(...)` anti-pattern.
   */
  fireAndForget(options: AuditLogOptions): void {
    this.log(options).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Audit fire-and-forget failed (secondary catch): ${msg}`,
      );
    });
  }
}
