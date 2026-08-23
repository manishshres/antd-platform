import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { DRIZZLE } from '../database/database.module';
import { TelnyxService } from '../telnyx/telnyx.service';
import { InvitationsService } from '../invitations/invitations.service';
import { AuditService } from '../common/services/audit.service';
import { ProvisioningProcessor } from './provisioning.processor';

type LocationRow = Record<string, unknown>;

/** Drizzle chain stub whose select resolves to whatever row is queued. */
const buildDb = (rows: LocationRow[]) => ({
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  }),
  update: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue([]),
    }),
  }),
});

const buildProcessor = async (db: ReturnType<typeof buildDb>) => {
  const telnyx = {
    cloneAssistant: jest.fn().mockResolvedValue({ id: 'asst-new' }),
    createNumberOrder: jest.fn().mockResolvedValue({ data: { id: 'order-1' } }),
    getNumberOrder: jest.fn(),
    getPhoneNumbersByNumber: jest.fn(),
    setAssistantDynamicVariablesOrThrow: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProvisioningProcessor,
      { provide: DRIZZLE, useValue: db },
      { provide: TelnyxService, useValue: telnyx },
      { provide: ConfigService, useValue: { get: () => undefined } },
      { provide: InvitationsService, useValue: { create: jest.fn() } },
      { provide: AuditService, useValue: { fireAndForget: jest.fn() } },
      { provide: getQueueToken('import-queue'), useValue: { add: jest.fn() } },
    ],
  }).compile();

  return {
    processor: module.get(ProvisioningProcessor),
    telnyx,
  };
};

/** The step methods are private; provisioning drives them by name. */
const callStep = (
  processor: ProvisioningProcessor,
  step: string,
  ...args: unknown[]
) =>
  (
    processor as unknown as Record<
      string,
      (...a: unknown[]) => Promise<unknown>
    >
  )[step](...args);

describe('ProvisioningProcessor — retries must not duplicate paid resources', () => {
  it('skips cloning when the location already has an assistant', async () => {
    // A step re-runs on any retry: operator-triggered, BullMQ attempts, or the stalled
    // sweep after a worker dies. Cloning again orphans the assistant already wired up.
    const db = buildDb([
      {
        telnyxAssistantId: 'asst-existing',
        masterAgentId: 'asst-master',
        aiSettings: { baseAgentId: 'asst-master' },
      },
    ]);
    const { processor, telnyx } = await buildProcessor(db);
    const metadata: Record<string, unknown> = {};

    await callStep(processor, 'cloneAgent', 'loc-1', metadata);

    expect(telnyx.cloneAssistant).not.toHaveBeenCalled();
    expect(metadata.assistantId).toBe('asst-existing');
  });

  it('clones when there is no assistant yet', async () => {
    const db = buildDb([
      { telnyxAssistantId: null, aiSettings: { baseAgentId: 'asst-master' } },
    ]);
    const { processor, telnyx } = await buildProcessor(db);
    const metadata: Record<string, unknown> = {};

    await callStep(processor, 'cloneAgent', 'loc-1', metadata);

    expect(telnyx.cloneAssistant).toHaveBeenCalledWith('asst-master');
    expect(metadata.assistantId).toBe('asst-new');
  });

  it('hands the generated webhook key to the assistant as order_key', async () => {
    // Only the hash is stored and the key is shown nowhere, so an assistant that never
    // receives it authenticates with a key that hashes to nothing on record — every AI
    // order webhook 401s, with no way to recover the value afterwards.
    const db = buildDb([{ telnyxAssistantId: 'asst-1' }]);
    const { processor, telnyx } = await buildProcessor(db);

    await callStep(processor, 'registerWebhook', 'org-1', 'loc-1');

    expect(telnyx.setAssistantDynamicVariablesOrThrow).toHaveBeenCalledTimes(1);
    const [assistantId, vars] = telnyx.setAssistantDynamicVariablesOrThrow.mock
      .calls[0] as [string, { order_key: string }];
    expect(assistantId).toBe('asst-1');
    expect(vars.order_key).toMatch(/^sk_live_[0-9a-f]{48}$/);
  });

  it('fails the step when there is no assistant to give the key to', async () => {
    const db = buildDb([{ telnyxAssistantId: null }]);
    const { processor } = await buildProcessor(db);

    await expect(
      callStep(processor, 'registerWebhook', 'org-1', 'loc-1'),
    ).rejects.toThrow(/no Voice AI assistant/);
  });

  it('skips the number order when the location already holds a number', async () => {
    // This one bills: a retry used to place a second order for a number nothing would use.
    const db = buildDb([
      { phoneNumber: '+15550001111', telnyxPhoneNumberId: 'phone-existing' },
    ]);
    const { processor, telnyx } = await buildProcessor(db);
    const metadata: Record<string, unknown> = {};

    await callStep(processor, 'purchasePhoneNumber', 'loc-1', metadata, {
      search_phone_number: { selectedPhoneNumber: '+15559998888' },
    });

    expect(telnyx.createNumberOrder).not.toHaveBeenCalled();
    expect(metadata.telnyxPhoneNumberId).toBe('phone-existing');
    expect(metadata.phoneNumber).toBe('+15550001111');
  });
});
