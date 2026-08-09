import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { TelnyxService } from '../telnyx/telnyx.service';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { notDeleted } from '../database/db.utils';

/**
 * Neutral agent DTO — hides all Telnyx-specific terminology from customers.
 * Field names are provider-agnostic.
 */
export interface AgentDto {
  id: string;
  name: string;
  status: string;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Maps a raw Telnyx assistant object to the neutral AgentDto.
 * This is the white-labeling boundary — Telnyx brand never crosses this.
 */
function mapToAgentDto(raw: Record<string, unknown>): AgentDto {
  return {
    id: (raw.id as string) ?? '',
    name: (raw.name as string) ?? 'Unnamed Agent',
    status: (raw.status as string) ?? 'active',
    description: (raw.description as string) ?? null,
    createdAt: (raw.created_at as string) ?? null,
    updatedAt: (raw.updated_at as string) ?? null,
  };
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly telnyxService: TelnyxService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Lists agents belonging to the organization.
   * If the org has local agent records (orgAgents table), we use those IDs
   * to filter the Telnyx response, ensuring cross-org isolation.
   */
  async listAgents(
    organizationId: string | null,
    locationId?: string,
  ): Promise<AgentDto[]> {
    this.logger.log(
      `Fetching agents for org: ${organizationId ?? 'unscoped'}, location: ${locationId ?? 'all'}`,
    );

    const raw = await this.telnyxService.getAssistants();
    const list = this.toRecordArray(raw);

    if (organizationId) {
      const allowedIds = new Set<string>();

      // 1. Check org_agents table
      const orgAgentRecords = await this.db
        .select({ externalId: schema.orgAgents.externalId })
        .from(schema.orgAgents)
        .where(
          and(
            eq(schema.orgAgents.organizationId, organizationId),
            notDeleted(schema.orgAgents),
          ),
        );
      orgAgentRecords.forEach((r) => allowedIds.add(r.externalId));

      // 2. Check locations table (telnyxAssistantId)
      const locConditions = [
        eq(schema.locations.organizationId, organizationId),
        notDeleted(schema.locations),
      ];
      if (locationId) {
        locConditions.push(eq(schema.locations.id, locationId));
      }
      const locRecords = await this.db
        .select({ assistantId: schema.locations.telnyxAssistantId })
        .from(schema.locations)
        .where(and(...locConditions));

      locRecords.forEach((r) => {
        if (r.assistantId) allowedIds.add(r.assistantId);
      });

      if (allowedIds.size > 0) {
        return list
          .filter((a) => allowedIds.has(a.id as string))
          .map(mapToAgentDto);
      }
    }

    return [];
  }

  /**
   * Gets a single agent, verifying it belongs to the organization.
   */
  async getAgent(id: string, organizationId: string | null): Promise<AgentDto> {
    this.logger.log(
      `Fetching agent ${id} for org: ${organizationId ?? 'unscoped'}`,
    );

    await this.verifyOrgOwnership(id, organizationId);

    const raw = await this.telnyxService.getAssistant(id);
    return mapToAgentDto(raw as Record<string, unknown>);
  }

  /**
   * Updates an agent, verifying it belongs to the organization first.
   */
  async updateAgent(
    id: string,
    body: Record<string, unknown>,
    organizationId: string | null,
  ): Promise<AgentDto> {
    this.logger.log(
      `Updating agent ${id} for org: ${organizationId ?? 'unscoped'}`,
    );

    await this.verifyOrgOwnership(id, organizationId);

    const raw = await this.telnyxService.updateAssistant(id, body);
    return mapToAgentDto(raw as Record<string, unknown>);
  }

  /**
   * Verifies an agent's externalId belongs to the given org.
   * Throws ForbiddenException if the agent is not in the org's allowed list.
   * If no local org records exist yet, skips the check (backward compat).
   */
  private async verifyOrgOwnership(
    agentExternalId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (!organizationId) return;

    const orgAgentRecords = await this.db
      .select()
      .from(schema.orgAgents)
      .where(
        and(
          eq(schema.orgAgents.organizationId, organizationId),
          notDeleted(schema.orgAgents),
        ),
      );

    // Strictly enforce multi-tenancy: if the org has no records, they have no access.
    if (orgAgentRecords.length === 0) {
      throw new ForbiddenException(
        'Agent does not belong to your organization.',
      );
    }

    const allowed = orgAgentRecords.find(
      (r) => r.externalId === agentExternalId,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Agent does not belong to your organization.',
      );
    }

    // Verify the agent actually exists upstream
    try {
      await this.telnyxService.getAssistant(agentExternalId);
    } catch {
      throw new NotFoundException(`Agent ${agentExternalId} not found.`);
    }
  }

  async updateLocationAgent(
    locationId: string,
    body: Record<string, unknown>,
    organizationId: string | null,
  ): Promise<AgentDto> {
    if (!organizationId) {
      throw new ForbiddenException('Organization ID is required.');
    }
    const [location] = await this.db
      .select({ telnyxAssistantId: schema.locations.telnyxAssistantId })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.id, locationId),
          eq(schema.locations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!location) {
      throw new NotFoundException(
        'Location not found or does not belong to your organization.',
      );
    }

    if (!location.telnyxAssistantId) {
      throw new NotFoundException(
        'Location does not have an associated AI assistant.',
      );
    }

    const raw = await this.telnyxService.updateAssistant(
      location.telnyxAssistantId,
      body,
    );
    return mapToAgentDto(raw as Record<string, unknown>);
  }

  private toRecordArray(raw: unknown): Record<string, unknown>[] {
    if (!raw) return [];
    const obj = raw as { data?: Record<string, unknown>[] };
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    return [];
  }
}
