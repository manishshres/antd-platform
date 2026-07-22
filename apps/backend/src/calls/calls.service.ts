import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { eq, and, desc, count, ilike, SQL } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { ExportService } from '../export/export.service';
import {
  CallRecordDto,
  ConversationMessageDto,
  ConversationResponseDto,
} from './dto/call-record.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly storageService: StorageService,
    private readonly exportService: ExportService,
  ) {}

  async listCalls(
    user: CurrentUserPayload,
    pagination: PaginationDto,
    search?: string,
  ): Promise<PaginatedResponseDto<CallRecordDto>> {
    const orgScopes = this.resolveOrgScope(user);
    if (!orgScopes) {
      // platform-admin without ?orgId= must NOT list calls across tenants.
      return { data: [], total: 0, hasMore: false };
    }

    const { orgId, isPlatformAdmin: _isPlatformAdmin } = orgScopes;
    const { offset = 0, limit = 20, locationId } = pagination;

    const conditions: (SQL<unknown> | undefined)[] = [
      // Always restrict by tenant. Platform-admins are still scoped to orgId.
      eq(schema.recordings.organizationId, orgId),
    ];

    if (locationId) {
      conditions.push(eq(schema.recordings.locationId, locationId));
    }

    if (search) {
      conditions.push(ilike(schema.recordings.transcript, `%${search}%`));
    }

    const whereClause = and(...conditions);

    const dbRecordings = await this.db
      .select()
      .from(schema.recordings)
      .where(whereClause)
      .orderBy(desc(schema.recordings.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.recordings)
      .where(whereClause);

    const data = await Promise.all(
      dbRecordings.map(async (r) => {
        let recordingUrl = null;
        if (r.objectKey && r.status === 'uploaded') {
          try {
            recordingUrl = await this.storageService.getSignedUrl(r.objectKey);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(
              `Failed to get signed url for ${r.objectKey}: ${msg}`,
            );
          }
        }

        return {
          id: r.id,
          from: r.fromNumber ?? '—',
          to: r.toNumber ?? '—',
          durationMs: r.durationMs ?? 0,
          status: r.status,
          startedAt: r.createdAt.toISOString(),
          recordingUrl,
          transcriptText: r.transcript,
          transcriptStatus: r.transcript ? 'completed' : 'pending',
          sessionId: r.callSessionId,
          aiSummary: r.aiSummary,
          sentiment: r.sentiment,
          callOutcome: r.callOutcome,
          tags: r.tags,
        };
      }),
    );

    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Resolve the tenant scope for a calls query. Returns `null` when the
   * caller is a platform-admin without an explicit `?orgId=` — they must
   * choose a tenant before listing calls, by design.
   *
   * P8-001: the original implementation side-stepped the tenant filter for
   * unauthenticated-broad platform-admin requests, returning rows from every
   * tenant. This helper centralizes the rule so all callers behave the same.
   */
  private resolveOrgScope(user: CurrentUserPayload): {
    orgId: string;
    isPlatformAdmin: boolean;
  } | null {
    if (user.organizationId)
      return {
        orgId: user.organizationId,
        isPlatformAdmin: user.isPlatformAdmin,
      };
    if (user.isPlatformAdmin) {
      // The 17.0 audits allowed unauthenticated-broad admin reads; we
      // require an orgId override. Currently set in JwtStrategy from
      // `?orgId=`. Calls from a UI without the override simply return [].
      this.logger.warn(
        `Platform admin ${user.email} called calls endpoints without an orgId scope; returning empty.`,
      );
      return null;
    }
    return null;
  }

  async getCall(
    id: string,
    organizationId: string | null,
  ): Promise<CallRecordDto> {
    if (!organizationId) throw new NotFoundException('Call not found.');
    const r = await this.db.query.recordings.findFirst({
      where: and(
        eq(schema.recordings.id, id),
        eq(schema.recordings.organizationId, organizationId),
      ),
    });
    if (!r) throw new NotFoundException('Call not found.');

    let recordingUrl = null;
    if (r.objectKey && r.status === 'uploaded') {
      try {
        recordingUrl = await this.storageService.getSignedUrl(r.objectKey);
      } catch {
        // ignore
      }
    }

    return {
      id: r.id,
      from: r.fromNumber ?? '—',
      to: r.toNumber ?? '—',
      durationMs: r.durationMs ?? 0,
      status: r.status,
      startedAt: r.createdAt.toISOString(),
      recordingUrl,
      transcriptText: r.transcript,
      transcriptStatus: r.transcript ? 'completed' : 'pending',
      sessionId: r.callSessionId,
      aiSummary: r.aiSummary,
      sentiment: r.sentiment,
      callOutcome: r.callOutcome,
      tags: r.tags,
    };
  }

  async getRecordingStream(
    id: string,
    organizationId: string | null,
  ): Promise<NodeJS.ReadableStream> {
    if (!organizationId) throw new NotFoundException('Call not found.');
    const r = await this.db.query.recordings.findFirst({
      where: and(
        eq(schema.recordings.id, id),
        eq(schema.recordings.organizationId, organizationId),
      ),
    });
    if (!r || !r.objectKey) {
      throw new NotFoundException('Recording audio is not available.');
    }
    return this.storageService.getObjectStream(r.objectKey);
  }

  async exportCallsCsv(organizationId: string | null): Promise<string> {
    if (!organizationId) throw new NotFoundException('Organization not found.');

    const dbRecordings = await this.db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.organizationId, organizationId))
      .orderBy(desc(schema.recordings.createdAt));

    const exportData = dbRecordings.map((r) => ({
      ID: r.id,
      Date: r.createdAt.toISOString(),
      From: r.fromNumber ?? '',
      To: r.toNumber ?? '',
      'Duration (ms)': r.durationMs ?? 0,
      Status: r.status,
      Sentiment: r.sentiment ?? '',
      'Call Outcome': r.callOutcome ?? '',
    }));

    return this.exportService.exportCsv(
      exportData,
      Object.keys(exportData[0] || {}),
    );
  }

  async exportCallsExcel(organizationId: string | null): Promise<Buffer> {
    if (!organizationId) throw new NotFoundException('Organization not found.');

    const dbRecordings = await this.db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.organizationId, organizationId))
      .orderBy(desc(schema.recordings.createdAt));

    const exportData = dbRecordings.map((r) => ({
      ID: r.id,
      Date: r.createdAt.toISOString(),
      From: r.fromNumber ?? '',
      To: r.toNumber ?? '',
      'Duration (ms)': r.durationMs ?? 0,
      Status: r.status,
      Sentiment: r.sentiment ?? '',
      'Call Outcome': r.callOutcome ?? '',
    }));

    return this.exportService.exportExcel(exportData, 'Calls');
  }

  async getCallMessages(
    id: string,
    organizationId: string | null,
  ): Promise<ConversationResponseDto> {
    this.logger.log(`Fetching conversation messages for call ${id}`);
    if (!organizationId) return { messages: [], conversationId: null };

    // Find the recording logically linked
    const recs = await this.db
      .select({ callSessionId: schema.recordings.callSessionId })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, id),
          eq(schema.recordings.organizationId, organizationId),
        ),
      )
      .limit(1);

    const rec = recs[0];
    if (!rec) return { messages: [], conversationId: null };

    const convs = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.callSessionId, rec.callSessionId),
          eq(schema.conversations.organizationId, organizationId),
        ),
      )
      .limit(1);

    const conv = convs[0];
    if (!conv) return { messages: [], conversationId: null };

    const messages = conv.messages as ConversationMessageDto[];
    return { messages, conversationId: conv.id };
  }
}
