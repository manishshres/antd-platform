import { UnauthorizedException } from '@nestjs/common';
import { UberEatsWebhookController } from './ubereats-webhook.controller';

/**
 * The Uber-specific receiver's job: resolve the tenant from the store id in the body (Uber
 * uses one Primary URL for every store), verify the HMAC, dedupe/enqueue, and ack with an
 * empty 200. Plain-object mocks keep the unbound-method lint rule quiet.
 */
describe('UberEatsWebhookController', () => {
  let controller: UberEatsWebhookController;
  let adapter: { validateWebhook: jest.Mock; parseEvent: jest.Mock };
  let encryption: { decryptJson: jest.Mock };
  let repo: {
    findProviderByName: jest.Mock;
    findIntegrationAccountByProviderStoreId: jest.Mock;
  };
  let ingest: { ingest: jest.Mock };

  const body = {
    event_id: 'evt-1',
    event_type: 'orders.notification',
    resource_href: 'https://api.uber.com/v2/eats/order/ord-1',
    meta: { user_id: 'store-a', resource_id: 'ord-1' },
  };
  const headers = { 'x-uber-signature': 'sig' };
  const req = {
    rawBody: Buffer.from(JSON.stringify(body)),
  } as unknown as Parameters<UberEatsWebhookController['handle']>[2];

  beforeEach(() => {
    adapter = {
      validateWebhook: jest.fn().mockReturnValue(true),
      parseEvent: jest.fn().mockReturnValue({
        externalEventId: 'evt-1',
        eventType: 'order.created',
        externalOrderId: 'ord-1',
        rawPayload: body,
      }),
    };
    encryption = {
      decryptJson: jest.fn().mockReturnValue({ clientSecret: 'secret' }),
    };
    repo = {
      findProviderByName: jest
        .fn()
        .mockResolvedValue({ id: 'prov-uber', isActive: true }),
      findIntegrationAccountByProviderStoreId: jest.fn().mockResolvedValue({
        id: 'acct-1',
        organizationId: 'org-1',
        locationId: 'loc-1',
        providerId: 'prov-uber',
        credentials: 'enc',
      }),
    };
    ingest = {
      ingest: jest.fn().mockResolvedValue({ duplicate: false }),
    };

    controller = new UberEatsWebhookController(
      adapter as never,
      encryption as never,
      repo as never,
      ingest as never,
    );
  });

  it('resolves the tenant by store id and enqueues with the resource_href', async () => {
    await controller.handle(body, headers, req);

    expect(repo.findIntegrationAccountByProviderStoreId).toHaveBeenCalledWith(
      'prov-uber',
      'store-a',
    );
    expect(ingest.ingest).toHaveBeenCalledTimes(1);
    const arg = (ingest.ingest.mock.calls[0] as unknown[])[0] as {
      provider: string;
      organizationId: string;
      resourceHref?: string;
      eventId: string;
    };
    expect(arg.provider).toBe('ubereats');
    expect(arg.organizationId).toBe('org-1');
    expect(arg.resourceHref).toBe('https://api.uber.com/v2/eats/order/ord-1');
    expect(arg.eventId).toBe('ubereats:evt-1');
  });

  it('verifies the HMAC over the exact received bytes', async () => {
    await controller.handle(body, headers, req);
    expect(adapter.validateWebhook).toHaveBeenCalledWith(req.rawBody, headers, {
      clientSecret: 'secret',
    });
  });

  it('rejects an invalid signature before enqueuing', async () => {
    adapter.validateWebhook.mockReturnValue(false);
    await expect(controller.handle(body, headers, req)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('rejects when no account maps to the store id', async () => {
    repo.findIntegrationAccountByProviderStoreId.mockResolvedValue(null);
    await expect(controller.handle(body, headers, req)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('acknowledges (no throw) when the event carries no store id', async () => {
    await expect(
      controller.handle({ event_type: 'orders.notification' }, headers, req),
    ).resolves.toBeUndefined();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('acks duplicates without error', async () => {
    ingest.ingest.mockResolvedValue({ duplicate: true });
    await expect(
      controller.handle(body, headers, req),
    ).resolves.toBeUndefined();
  });
});
