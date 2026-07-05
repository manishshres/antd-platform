import { Job, UnrecoverableError } from 'bullmq';
import { MenuAiSyncProcessor } from './menu-ai-sync.processor';
import { MenusService } from '../menus.service';
import { TelnyxStorageSuspendedError } from '../../telnyx/telnyx.service';

function job(orgId: string): Job<{ orgId: string }, unknown, string> {
  return { data: { orgId } } as unknown as Job<
    { orgId: string },
    unknown,
    string
  >;
}

describe('MenuAiSyncProcessor', () => {
  function make(syncImpl: jest.Mock) {
    const menus = {
      syncOrgPublishedLocationsToAI: syncImpl,
    } as unknown as MenusService;
    return new MenuAiSyncProcessor(menus);
  }

  it('returns the synced count on success', async () => {
    const proc = make(jest.fn().mockResolvedValue(2));
    await expect(proc.process(job('org-1'))).resolves.toEqual({
      orgId: 'org-1',
      synced: 2,
    });
  });

  it('converts a Telnyx storage suspension into a non-retryable UnrecoverableError', async () => {
    const proc = make(
      jest.fn().mockRejectedValue(new TelnyxStorageSuspendedError()),
    );
    await expect(proc.process(job('org-1'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('lets other errors propagate so BullMQ retries them', async () => {
    const boom = new Error('transient network blip');
    const proc = make(jest.fn().mockRejectedValue(boom));
    await expect(proc.process(job('org-1'))).rejects.toBe(boom);
  });
});
