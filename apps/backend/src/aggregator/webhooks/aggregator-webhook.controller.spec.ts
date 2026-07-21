import { UnauthorizedException } from '@nestjs/common';
import { AggregatorWebhookController } from './aggregator-webhook.controller';
import { ProviderRegistryService } from '../core/services/provider-registry.service';
import { CredentialEncryptionService } from '../core/services/credential-encryption.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import { AggregatorWebhookJob } from '../queues/aggregator-webhook.types';

describe('AggregatorWebhookController', () => {
  let controller: AggregatorWebhookController;
  let db: { insert: jest.Mock; delete: jest.Mock };
  let queue: { add: jest.Mock };
  let registry: jest.Mocked<ProviderRegistryService>;
  let encryption: jest.Mocked<CredentialEncryptionService>;
  let repo: jest.Mocked<AggregatorRepository>;
  let webhookProvider: { validateWebhook: jest.Mock; parseEvent: jest.Mock };

  // db.insert(...).values(...).onConflictDoNothing().returning() → resolves `reserved`.
  function mockInsert(reserved: unknown[]) {
    const chain: {
      values: jest.Mock;
      onConflictDoNothing: jest.Mock;
      returning: jest.Mock;
    } = {
      values: jest.fn(() => chain),
      onConflictDoNothing: jest.fn(() => chain),
      returning: jest.fn(() => Promise.resolve(reserved)),
    };
    db.insert.mockReturnValue(chain);
  }

  const headers = { authorization: 'Bearer good-secret' };
  const body = { type: 'Order', order: { id: 'kh-1', status: 'new' } };
  const req = {
    rawBody: Buffer.from(JSON.stringify(body)),
  } as unknown as Parameters<AggregatorWebhookController['handle']>[4];

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const deleteChain = { where: jest.fn(() => Promise.resolve()) };
    db = {
      insert: jest.fn(),
      delete: jest.fn(() => deleteChain),
    };
    webhookProvider = {
      validateWebhook: jest.fn().mockReturnValue(true),
      parseEvent: jest.fn().mockReturnValue({
        externalEventId: 'evt-1',
        eventType: 'order.created',
        externalOrderId: 'kh-1',
        rawPayload: body,
      }),
    };
    registry = {
      has: jest.fn().mockReturnValue(true),
      getWebhookProvider: jest.fn().mockReturnValue(webhookProvider),
    } as unknown as jest.Mocked<ProviderRegistryService>;
    encryption = {
      decryptJson: jest.fn().mockReturnValue({ webhookSecret: 'good-secret' }),
    } as unknown as jest.Mocked<CredentialEncryptionService>;
    repo = {
      findIntegrationAccountById: jest.fn().mockResolvedValue({
        id: 'acct-1',
        organizationId: 'org-1',
        locationId: 'loc-1',
        providerId: 'prov-1',
        credentials: 'enc',
      }),
      findProviderByName: jest
        .fn()
        .mockResolvedValue({ id: 'prov-1', isActive: true }),
      recordWebhookDelivery: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AggregatorRepository>;

    controller = new AggregatorWebhookController(
      db as never,
      queue as never,
      registry,
      encryption,
      repo,
    );
  });

  it('validates, reserves, and enqueues a fresh event (202)', async () => {
    mockInsert([{ eventId: 'kitchenhub:evt-1' }]); // reservation won

    const res = await controller.handle(
      'kitchenhub',
      'acct-1',
      body,
      headers,
      req,
    );

    expect(res).toEqual({ received: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
    const job = (queue.add.mock.calls[0] as [string, AggregatorWebhookJob])[1];
    expect(job.provider).toBe('kitchenhub');
    expect(job.organizationId).toBe('org-1');
    expect(job.webhookEventId).toBe('kitchenhub:evt-1');
  });

  it('dedupes a re-delivered event without enqueuing', async () => {
    mockInsert([]); // conflict → already reserved

    const res = await controller.handle(
      'kitchenhub',
      'acct-1',
      body,
      headers,
      req,
    );

    expect(res).toEqual({ received: true, duplicate: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects an invalid webhook secret', async () => {
    webhookProvider.validateWebhook.mockReturnValue(false);

    await expect(
      controller.handle('kitchenhub', 'acct-1', body, headers, req),
    ).rejects.toThrow(UnauthorizedException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects an account that belongs to a different provider', async () => {
    repo.findProviderByName.mockResolvedValue({
      id: 'other-prov',
      isActive: true,
    });

    await expect(
      controller.handle('kitchenhub', 'acct-1', body, headers, req),
    ).rejects.toThrow(UnauthorizedException);
  });
});
