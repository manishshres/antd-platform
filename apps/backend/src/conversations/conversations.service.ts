import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { BillingService } from '../billing/billing.service';

export interface ChatMessage {
  role: string;
  text: string;
  sentAt: string | Date;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
  ) {}

  async listConversations(
    user: CurrentUserPayload,
    pagination: PaginationDto,
    locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    // Resolve the org from the JWT context (a platform admin's selected org via ?orgId=), which
    // both scopes the query correctly and avoids returning every tenant's conversations.
    const orgId = await this.billingService.getRequiredOrg(user);
    const { offset = 0, limit = 20 } = pagination;

    const conditions = [];
    if (orgId) conditions.push(eq(schema.conversations.organizationId, orgId));
    if (locationId)
      conditions.push(eq(schema.conversations.locationId, locationId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await this.db
      .select({
        id: schema.conversations.id,
        callSessionId: schema.conversations.callSessionId,
        locationId: schema.conversations.locationId,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversations)
      .where(whereClause)
      .orderBy(desc(schema.conversations.createdAt))
      .limit(limit)
      .offset(offset);

    // Normally we'd do a count query, mocking for brevity
    return {
      data,
      total: data.length, // Mocked total
      hasMore: data.length === limit,
    };
  }

  async getConversation(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const res = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.organizationId, orgId),
        ),
      )
      .limit(1);

    if (res.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    return res[0];
  }

  async addMessage(
    organizationId: string,
    locationId: string,
    callSessionId: string,
    message: ChatMessage,
  ) {
    // Upsert logic for a conversation thread
    const existing = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.callSessionId, callSessionId),
          eq(schema.conversations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const messages = (existing[0].messages as ChatMessage[]) || [];
      messages.push(message);

      const [updated] = await this.db
        .update(schema.conversations)
        .set({
          messages,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversations.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [inserted] = await this.db
        .insert(schema.conversations)
        .values({
          organizationId,
          locationId,
          callSessionId,
          messages: [message],
        })
        .returning();
      return inserted;
    }
  }
}
