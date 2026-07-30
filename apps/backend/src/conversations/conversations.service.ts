import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { BillingService } from '../billing/billing.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

export interface ChatMessage {
  role: string;
  text: string;
  sentAt: string | Date;
}

/** Telnyx `metadata` is free-form JSON; read a field only when it really is a string. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    private readonly telnyxService: TelnyxService,
    @InjectQueue('recordings-queue') private readonly recordingsQueue: Queue,
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

  async syncFromTelnyx(
    organizationId: string,
    locationId: string,
    telnyxAssistantId: string,
  ): Promise<number> {
    let syncedCount = 0;
    let pageNumber = 1;
    let totalPages = 1;

    do {
      // 1. Fetch AI conversations for this assistant from Telnyx (server-side filtered using PostgREST syntax)
      const res = await this.telnyxService.getConversations(
        telnyxAssistantId,
        pageNumber,
      );
      const matchingConversations = res?.data ?? [];
      totalPages = res?.meta?.total_pages ?? 1;

      // For each matching conversation, fetch messages and upsert
      for (const conv of matchingConversations) {
        const callSessionId = conv.id; // Using Telnyx conversation ID as callSessionId

        // Fetch messages for this conversation
        const msgRes = await this.telnyxService.getConversationMessages(
          conv.id,
        );
        const telnyxMessages = msgRes?.data ?? [];

        // Map to our local ChatMessage type, sorting by sentAt to ensure chronological order
        const messages: ChatMessage[] = telnyxMessages
          .map((m) => ({
            role: m.role ?? 'assistant',
            text: m.text ?? '',
            sentAt: m.sent_at ?? m.created_at ?? new Date().toISOString(),
          }))
          .sort(
            (a, b) =>
              new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
          );

        // Upsert into conversations DB
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
          await this.db
            .update(schema.conversations)
            .set({
              messages,
              updatedAt: new Date(),
            })
            .where(eq(schema.conversations.id, existing[0].id));
        } else {
          await this.db.insert(schema.conversations).values({
            organizationId,
            locationId,
            callSessionId,
            messages,
            createdAt: conv.created_at ? new Date(conv.created_at) : new Date(),
          });
        }

        // Upsert into recordings DB
        const existingRec = await this.db
          .select()
          .from(schema.recordings)
          .where(
            and(
              eq(schema.recordings.callSessionId, callSessionId),
              eq(schema.recordings.organizationId, organizationId),
            ),
          )
          .limit(1);

        const transcriptStr = messages
          .map((m) => `${m.role}: ${m.text}`)
          .join('\n');
        const startMs = conv.created_at
          ? new Date(conv.created_at).getTime()
          : Date.now();
        const endMs = conv.last_message_at
          ? new Date(conv.last_message_at).getTime()
          : startMs;

        if (existingRec.length > 0) {
          await this.db
            .update(schema.recordings)
            .set({
              transcript: transcriptStr,
              durationMs: Math.max(0, endMs - startMs),
              status: 'completed',
              updatedAt: new Date(),
            })
            .where(eq(schema.recordings.id, existingRec[0].id));
        } else {
          await this.db.insert(schema.recordings).values({
            organizationId,
            locationId,
            callSessionId,
            fromNumber: asString(conv.metadata?.from) ?? null,
            toNumber: asString(conv.metadata?.to) ?? null,
            transcript: transcriptStr,
            durationMs: Math.max(0, endMs - startMs),
            status: 'completed',
            createdAt: conv.created_at ? new Date(conv.created_at) : new Date(),
          });
        }

        // Try to fetch recording from Telnyx and enqueue import job
        try {
          // `metadata` is free-form on Telnyx's side, so narrow before use.
          const telnyxSessionId = asString(conv.metadata?.call_session_id);
          if (telnyxSessionId) {
            const recsRes =
              await this.telnyxService.getRecordings(telnyxSessionId);
            const recordings = recsRes?.data ?? [];
            const wavRecording = recordings.find(
              (r) => r.channels === 'single' || r.download_urls?.wav,
            );
            if (wavRecording) {
              await this.recordingsQueue.add('import-recording', {
                callSessionId, // Maps to schema.recordings.callSessionId (which is conv.id)
                recordingId: wavRecording.id,
                toNumber: asString(conv.metadata?.to),
                organizationId,
                locationId,
              });
            }
          }
        } catch (err) {
          // A missing or unreadable recording must not abort the conversation sync — but it
          // shouldn't vanish silently either (it used to be an empty catch).
          this.logger.warn(
            `Could not attach a recording to conversation ${conv.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        syncedCount++;
      }

      pageNumber++;
    } while (pageNumber <= totalPages);

    return syncedCount;
  }
}
