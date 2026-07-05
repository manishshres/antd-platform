import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { MenusService } from '../menus.service';
import { TelnyxStorageSuspendedError } from '../../telnyx/telnyx.service';

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
    try {
      const synced =
        await this.menusService.syncOrgPublishedLocationsToAI(orgId);
      this.logger.log(
        `Auto-synced menu to AI agent for org ${orgId} — ${synced} location(s) refreshed.`,
      );
      return { orgId, synced };
    } catch (err) {
      // Telnyx storage suspension (negative account credit) won't clear on retry — fail fast and
      // don't burn the 3 attempts. A later menu edit re-schedules a fresh job once credit is back.
      if (err instanceof TelnyxStorageSuspendedError) {
        this.logger.warn(
          `Skipping AI menu auto-sync for org ${orgId}: Telnyx Cloud Storage is suspended (negative account credit).`,
        );
        throw new UnrecoverableError('Telnyx Cloud Storage suspended');
      }
      throw err;
    }
  }
}
