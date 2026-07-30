import { UnauthorizedException } from '@nestjs/common';
import { AggregatorWebhookController } from './aggregator-webhook.controller';

describe('AggregatorWebhookController', () => {
  let controller: AggregatorWebhookController;
  let registry: { has: jest.Mock; getWebhookProvider: jest.Mock };
  let encryption: { decryptJson: jest.Mock };
  let repo: {
    findIntegrationAccountById: jest.Mock;
    findProviderByName: jest.Mock;
  };
  let ingest: { ingest: jest.Mock };
  let webhookProvider: { validateWebhook: jest.Mock; parseEvent: jest.Mock };

  const headers = { authorization: 'Bearer good-secret' };
  const body = { type: 'Order', order: { id: 'kh-1', status: 'new' } };
  const req = {
    rawBody: Buffer.from(JSON.stringify(body)),
  } as unknown as Parameters<AggregatorWebhookController['handle']>[4];

  beforeEach(() => {
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
    };
    encryption = {
      decryptJson: jest.fn().mockReturnValue({ webhookSecret: 'good-secret' }),
    };
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
    };
    ingest = {
      ingest: jest.fn().mockResolvedValue({ duplicate: false }),
    };

    controller = new AggregatorWebhookController(
      registry as never,
      encryption as never,
      repo as never,
      ingest as never,
    );
  });

  it('validates, reserves, and enqueues a fresh event via the ingest service', async () => {
    const res = await controller.handle(
      'kitchenhub',
      'acct-1',
      body,
      headers,
      req,
    );

    expect(res).toEqual({ received: true });
    expect(ingest.ingest).toHaveBeenCalledTimes(1);
    const arg = (ingest.ingest.mock.calls[0] as unknown[])[0] as {
      provider: string;
      organizationId: string;
      eventId: string;
    };
    expect(arg.provider).toBe('kitchenhub');
    expect(arg.organizationId).toBe('org-1');
    expect(arg.eventId).toBe('kitchenhub:evt-1');
  });

  it('dedupes a re-delivered event (ingest reports duplicate)', async () => {
    ingest.ingest.mockResolvedValue({ duplicate: true });

    const res = await controller.handle(
      'kitchenhub',
      'acct-1',
      body,
      headers,
      req,
    );

    expect(res).toEqual({ received: true, duplicate: true });
  });

  it('rejects an invalid webhook secret before enqueuing', async () => {
    webhookProvider.validateWebhook.mockReturnValue(false);

    await expect(
      controller.handle('kitchenhub', 'acct-1', body, headers, req),
    ).rejects.toThrow(UnauthorizedException);
    expect(ingest.ingest).not.toHaveBeenCalled();
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
