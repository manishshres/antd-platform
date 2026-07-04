import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, desc, gte, lte, count } from 'drizzle-orm';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';

@Injectable()
export class AuditLogsService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listAuditLogs(organizationId: string, query: AuditLogsQueryDto) {
    const {
      offset = 0,
      limit = 50,
      userId,
      action,
      entityType,
      startDate,
      endDate,
    } = query;

    const conditions = [eq(schema.auditLogs.organizationId, organizationId)];

    if (userId) {
      conditions.push(eq(schema.auditLogs.userId, userId));
    }
    if (action) {
      conditions.push(eq(schema.auditLogs.action, action));
    }
    if (entityType) {
      conditions.push(eq(schema.auditLogs.entityType, entityType));
    }
    if (startDate) {
      conditions.push(gte(schema.auditLogs.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(schema.auditLogs.createdAt, new Date(endDate)));
    }

    const whereClause = and(...conditions);

    // Get paginated data
    const data = await this.db
      .select({
        log: schema.auditLogs,
        userEmail: schema.users.email,
        userFirstName: schema.users.firstName,
        userLastName: schema.users.lastName,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
      .where(whereClause)
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.auditLogs)
      .where(whereClause);

    // Format results
    const formattedData = data.map((row) => ({
      ...row.log,
      userEmail: row.userEmail,
      userName:
        row.userFirstName || row.userLastName
          ? `${row.userFirstName || ''} ${row.userLastName || ''}`.trim()
          : null,
    }));

    return {
      data: formattedData,
      meta: {
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    };
  }
}
