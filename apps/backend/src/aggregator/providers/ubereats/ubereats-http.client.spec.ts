import { ConfigService } from '@nestjs/config';
import { UberEatsHttpClient } from './ubereats-http.client';
import { UberEatsCredentials } from './ubereats.types';
import { ProviderRequestError } from '../../core/errors/aggregator.errors';

/**
 * Guards the exact request line Uber validates against. The order-fulfillment verbs are
 * **v1** (`/v1/eats/orders/...`) while the order read API is still v2 — we shipped them all
 * as v2 once, which made every accept 404 and let orders auto-cancel after 11.5 minutes.
 */
describe('UberEatsHttpClient', () => {
  const creds: UberEatsCredentials = {
    clientId: 'client-1',
    clientSecret: 'secret-1',
    storeId: 'store-1',
  };

  let client: UberEatsHttpClient;
  let fetchMock: jest.Mock;

  /** First call is always the token request; the rest are the API calls under test. */
  function apiCall(index = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[index + 1] as [
      string,
      RequestInit,
    ];
    return { url, init };
  }

  function body(index = 0): Record<string, unknown> {
    return JSON.parse(apiCall(index).init.body as string) as Record<
      string,
      unknown
    >;
  }

  beforeEach(() => {
    fetchMock = jest.fn().mockImplementation((url: string) => {
      if (url.includes('oauth')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: 'token-1', expires_in: 3600 }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    global.fetch = fetchMock;
    client = new UberEatsHttpClient(new ConfigService({}));
  });

  it('accepts an order on the v1 endpoint with the required reason', async () => {
    await client.acceptOrder(creds, 'ord-1', {
      reason: 'Accepted by Coneeko POS',
      external_reference_id: 'order-1',
    });

    expect(apiCall().url).toBe(
      'https://api.uber.com/v1/eats/orders/ord-1/accept_pos_order',
    );
    expect(apiCall().init.method).toBe('POST');
    expect(body()).toEqual({
      reason: 'Accepted by Coneeko POS',
      external_reference_id: 'order-1',
    });
  });

  it('denies on the v1 endpoint', async () => {
    await client.denyOrder(creds, 'ord-1', {
      reason: { code: 'POS_OFFLINE', explanation: 'register offline' },
    });
    expect(apiCall().url).toBe(
      'https://api.uber.com/v1/eats/orders/ord-1/deny_pos_order',
    );
  });

  it('cancels on the v1 endpoint', async () => {
    await client.cancelOrder(creds, 'ord-1', { reason: 'KITCHEN_CLOSED' });
    expect(apiCall().url).toBe(
      'https://api.uber.com/v1/eats/orders/ord-1/cancel',
    );
  });

  it('fetches an order from the webhook resource_href verbatim, not a rebuilt path', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('oauth')
          ? new Response(
              JSON.stringify({ access_token: 't', expires_in: 60 }),
              {
                status: 200,
              },
            )
          : new Response(JSON.stringify({ id: 'ord-1' }), { status: 200 }),
      ),
    );

    const order = await client.getOrder(
      creds,
      'https://api.uber.com/v1/delivery/order/ord-1',
    );

    expect(apiCall().url).toBe('https://api.uber.com/v1/delivery/order/ord-1');
    expect(order?.id).toBe('ord-1');
  });

  it('PATCHes pos_data to toggle the integration on', async () => {
    await client.updatePosData(creds, 'store-1', { integration_enabled: true });

    expect(apiCall().url).toBe(
      'https://api.uber.com/v1/eats/stores/store-1/pos_data',
    );
    expect(apiCall().init.method).toBe('PATCH');
    expect(body()).toEqual({ integration_enabled: true });
  });

  it('sends the merchant user token (not the developer token) when activating', async () => {
    await client.activateIntegration('user-token', 'store-1', {
      is_order_manager: true,
    });

    // No token request at all — the caller's bearer is used as-is.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.uber.com/v1/eats/stores/store-1/pos_data');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer user-token',
    );
  });

  describe('merchant OAuth', () => {
    it('builds a consent URL asking only for eats.pos_provisioning', () => {
      const url = new URL(
        client.buildAuthorizeUrl({
          clientId: 'app-client',
          redirectUri: 'https://api.coneeko.test/cb',
          state: 'abc123',
        }),
      );

      expect(`${url.origin}${url.pathname}`).toBe(
        'https://auth.uber.com/oauth/v2/authorize',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('eats.pos_provisioning');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://api.coneeko.test/cb',
      );
      expect(url.searchParams.get('state')).toBe('abc123');
    });

    it('exchanges an authorization code with the matching redirect_uri', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'merchant-token', expires_in: 120 }),
          { status: 200 },
        ),
      );

      const token = await client.exchangeAuthorizationCode({
        clientId: 'app-client',
        clientSecret: 'app-secret',
        code: 'auth-code',
        redirectUri: 'https://api.coneeko.test/cb',
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://auth.uber.com/oauth/v2/token');
      const form = new URLSearchParams(init.body as string);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('auth-code');
      expect(form.get('redirect_uri')).toBe('https://api.coneeko.test/cb');
      expect(token.accessToken).toBe('merchant-token');
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('pages GET /v1/eats/stores until next_key runs out', async () => {
      const pages = [
        { stores: [{ store_id: 's1' }], next_key: 'k2' },
        { stores: [{ store_id: 's2' }], next_key: '' },
      ];
      let call = 0;
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(pages[call++]), { status: 200 }),
        ),
      );

      const stores = await client.listStores('merchant-token');

      expect(stores.map((s) => s.store_id)).toEqual(['s1', 's2']);
      const [, second] = fetchMock.mock.calls.map(
        (args) => (args as [string, RequestInit])[0],
      );
      expect(second).toContain('start_key=k2');
    });
  });

  it('surfaces a non-auth failure as ProviderRequestError with the status', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('oauth')
          ? new Response(
              JSON.stringify({ access_token: 't', expires_in: 60 }),
              {
                status: 200,
              },
            )
          : new Response('not the order manager', { status: 403 }),
      ),
    );

    const error = await client
      .acceptOrder(creds, 'ord-1', { reason: 'x' })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).status).toBe(403);
  });
});
