import { Job } from 'bullmq';
import { RecordingsProcessor } from './recordings.processor';

/** Chainable select() mock whose `.limit()` resolves to `rows`. */
function selectResult(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeDb() {
  return {
    select: jest.fn(),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoUpdate: jest.fn(() => Promise.resolve()),
        onConflictDoNothing: jest.fn(() => Promise.resolve()),
      })),
    })),
  };
}

function makeProcessor(db: unknown, telnyx: unknown) {
  const storage = {};
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const analytics = { recordUsage: jest.fn() };
  return new RecordingsProcessor(
    storage as never,
    telnyx as never,
    config as never,
    analytics as never,
    db as never,
  );
}

function job(data: Record<string, unknown>): Job {
  return { data } as unknown as Job;
}

describe('RecordingsProcessor — tenant resolution (C2)', () => {
  it('skips the recording when the dialed number matches no tenant', async () => {
    const db = makeDb();
    // org_phone_numbers lookup → [], then locations lookup → []
    db.select
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(selectResult([]));
    const telnyx = { getRecordings: jest.fn() };
    const proc = makeProcessor(db, telnyx);

    await proc.process(
      job({ callSessionId: 's1', recordingId: 'r1', toNumber: '+15551230000' }),
    );

    // Never proceeds to fetch/assign the recording — no cross-tenant assignment.
    expect(telnyx.getRecordings).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips when no dialed number is provided', async () => {
    const db = makeDb();
    const telnyx = { getRecordings: jest.fn() };
    const proc = makeProcessor(db, telnyx);

    await proc.process(job({ callSessionId: 's2', recordingId: 'r2' }));

    expect(telnyx.getRecordings).not.toHaveBeenCalled();
  });

  it('proceeds once the number resolves to an org phone mapping', async () => {
    const db = makeDb();
    // 1st select: tenant resolution -> mapped org phone
    // 2nd select: idempotency check -> not uploaded yet
    db.select
      .mockReturnValueOnce(
        selectResult([{ organizationId: 'org-1', locationId: 'loc-1' }]),
      )
      .mockReturnValueOnce(selectResult([]));

    // getRecordings returns nothing → the processor throws downstream, but the point is that
    // tenant resolution succeeded and it did NOT skip.
    const telnyx = { getRecordings: jest.fn().mockResolvedValue({ data: [] }) };
    const proc = makeProcessor(db, telnyx);

    await expect(
      proc.process(
        job({
          callSessionId: 's3',
          recordingId: 'r3',
          toNumber: '+15551234567',
        }),
      ),
    ).rejects.toBeDefined();

    expect(telnyx.getRecordings).toHaveBeenCalledWith('s3');
  });
});
