import {
  Injectable,
  Logger,
  BadRequestException,
  UnprocessableEntityException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { TelnyxService } from '../telnyx/telnyx.service';
import { validateUpload } from './security';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { notDeleted } from '../database/db.utils';

export interface DocumentDto {
  id: string;
  filename: string;
  mimeType: string | null;
  createdAt: string | null;
}

function mapToDocumentDto(raw: Record<string, unknown>): DocumentDto {
  return {
    id: (raw.id as string) ?? '',
    filename: (raw.filename as string) ?? 'unnamed_file',
    mimeType: (raw.mime_type as string) ?? null,
    createdAt: (raw.created_at as string) ?? null,
  };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly telnyxService: TelnyxService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async listDocuments(organizationId: string | null): Promise<DocumentDto[]> {
    this.logger.log(
      `Fetching documents for organization: ${organizationId ?? 'unscoped'}`,
    );

    if (!organizationId) {
      return [];
    }

    // Fetch local document records scoped to organization
    const orgDocs = await this.db
      .select()
      .from(schema.orgDocuments)
      .where(
        and(
          eq(schema.orgDocuments.organizationId, organizationId),
          notDeleted(schema.orgDocuments),
        ),
      );

    if (orgDocs.length === 0) {
      return [];
    }

    const allowedIds = new Set(orgDocs.map((doc) => doc.externalId));

    try {
      const raw = await this.telnyxService.getDocuments();
      const list = this.toRecordArray(raw);

      return list
        .filter((doc) => allowedIds.has(doc.id as string))
        .map(mapToDocumentDto);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to list documents from provider: ${msg}`);
      // Fallback: return metadata from local DB if provider call fails
      return orgDocs.map((doc) => ({
        id: doc.externalId,
        filename: doc.filename,
        mimeType: doc.mimeType,
        createdAt: doc.createdAt.toISOString(),
      }));
    }
  }

  async uploadDocument(
    organizationId: string | null,
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<DocumentDto> {
    this.logger.log(
      `Uploading document "${filename}" for organization: ${organizationId ?? 'unscoped'}`,
    );

    if (!organizationId) {
      throw new ForbiddenException('Organization scope is required.');
    }

    if (!filename || buffer.length === 0) {
      throw new BadRequestException('No file provided.');
    }

    const check = validateUpload(filename, buffer);
    if (!check.ok) {
      throw new UnprocessableEntityException(check.reason);
    }

    // Upload to provider (Telnyx)
    const rawRes = await this.telnyxService.uploadDocument(
      filename,
      buffer,
      mimeType,
    );
    const rawObj =
      (rawRes as { data?: Record<string, unknown> })?.data ||
      (rawRes as Record<string, unknown>);

    const externalId = rawObj.id as string;
    if (!externalId) {
      throw new UnprocessableEntityException(
        'Failed to retrieve ID from upload provider response.',
      );
    }

    // Save local mapping
    await this.db.insert(schema.orgDocuments).values({
      organizationId,
      externalId,
      filename,
      mimeType: mimeType || null,
    });

    return mapToDocumentDto(rawObj);
  }

  async deleteDocument(
    id: string,
    organizationId: string | null,
  ): Promise<boolean> {
    this.logger.log(
      `Deleting document "${id}" for organization: ${organizationId ?? 'unscoped'}`,
    );

    if (!organizationId) {
      throw new ForbiddenException('Organization scope is required.');
    }

    if (!id) {
      throw new BadRequestException('Document ID is required.');
    }

    // Verify ownership
    const [localDoc] = await this.db
      .select()
      .from(schema.orgDocuments)
      .where(
        and(
          eq(schema.orgDocuments.externalId, id),
          eq(schema.orgDocuments.organizationId, organizationId),
          notDeleted(schema.orgDocuments),
        ),
      )
      .limit(1);

    if (!localDoc) {
      throw new NotFoundException('Document not found or access denied.');
    }

    // Delete from provider
    try {
      await this.telnyxService.deleteDocument(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to delete document from provider (it might have already been deleted): ${msg}`,
      );
    }

    // Soft delete locally
    await this.db
      .update(schema.orgDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.orgDocuments.id, localDoc.id));

    return true;
  }

  private toRecordArray(raw: unknown): Record<string, unknown>[] {
    if (!raw) return [];
    const obj = raw as { data?: Record<string, unknown>[] };
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    return [];
  }
}
