import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MenusService } from '../menus.service';

interface MenuAiSyncJobData {
  orgId: string;
}

/**
 * Debounced worker that re-publishes an org's menu to the Telnyx AI voice agent after edits.
 * Jobs are scheduled (and coalesced) from MenusService.invalidateMenuCache with a delay, so this
 * only runs once edits have settled. It re-syncs already-published locations; first-time publish
 * stays a manual action from the menu page.
 */
@Processor('menu-ai-sync-queue')
export class MenuAiSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MenuAiSyncProcessor.name);

  constructor(private readonly menusService: MenusService) {
    super();
  }

  async process(
    job: Job<MenuAiSyncJobData, unknown, string>,
  ): Promise<unknown> {
    const { orgId } = job.data;
    const synced = await this.menusService.syncOrgPublishedLocationsToAI(orgId);
    this.logger.log(
      `Auto-synced menu to AI agent for org ${orgId} — ${synced} location(s) refreshed.`,
    );
    return { orgId, synced };
  }
}
