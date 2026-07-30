import { ConfigService } from '@nestjs/config';
import { UberEatsOnboardingService } from './ubereats-onboarding.service';
import { UberEatsHttpClient } from '../providers/ubereats/ubereats-http.client';
import { UberEatsAdapter } from '../providers/ubereats/ubereats.adapter';
import { CredentialEncryptionService } from '../core/services/credential-encryption.service';
import { AggregatorRepository } from '../database/aggregator.repository';

/**
 * The callback lands with no JWT, so `state` is the entire security boundary — these tests
 * pin that it is single-use, that an unknown state never reaches the token exchange, and
 * that activation refuses any store id the merchant's own authorization didn't return.
 */
/** Typed read of a recorded mock argument (jest's mock.calls is `any[][]`). */
function nthArg<T>(mock: jest.Mock, index: number, call = 0): T {
  return (mock.mock.calls[call] as unknown[])[index] as T;
}

function firstArg<T>(mock: jest.Mock, call = 0): T {
  return nthArg<T>(mock, 0, call);
}

describe('UberEatsOnboardingService', () => {
  const env: Record<string, string> = {
    UBEREATS_CLIENT_ID: 'app-client',
    UBEREATS_CLIENT_SECRET: 'app-secret',
    PUBLIC_API_URL: 'https://api.coneeko.test',
    FRONTEND_URL: 'https://app.coneeko.test',
  };
  const redirectUri =
    'https://api.coneeko.test/api/v1/aggregator/ubereats/onboarding/callback';

  let service: UberEatsOnboardingService;
  let http: {
    buildAuthorizeUrl: jest.Mock;
    exchangeAuthorizationCode: jest.Mock;
    listStores: jest.Mock;
  };
  let adapter: { activateStore: jest.Mock };
  let repo: {
    findProviderByName: jest.Mock;
    createOauthSession: jest.Mock;
    claimOauthSessionByState: jest.Mock;
    findOauthSessionById: jest.Mock;
    updateOauthSession: jest.Mock;
    createIntegrationAccount: jest.Mock;
    deleteIntegrationAccount: jest.Mock;
  };

  const authorizedSession = {
    id: 'session-1',
    organizationId: 'org-1',
    locationId: null,
    status: 'authorized',
    accessToken: 'encrypted-token',
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    discoveredStores: [{ store_id: 'uber-store-1', name: 'Market' }],
  };

  beforeEach(() => {
    http = {
      buildAuthorizeUrl: jest
        .fn()
        .mockReturnValue('https://auth.uber.com/oauth/v2/authorize?x=1'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'merchant-token',
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      listStores: jest
        .fn()
        .mockResolvedValue([
          { store_id: 'uber-store-1', name: 'Market' },
          { name: 'no id — dropped' },
        ]),
    };
    adapter = { activateStore: jest.fn().mockResolvedValue({}) };
    repo = {
      findProviderByName: jest
        .fn()
        .mockResolvedValue({ id: 'prov-uber', isActive: true }),
      createOauthSession: jest.fn().mockImplementation((values: unknown) =>
        Promise.resolve({
          id: 'session-1',
          ...(values as Record<string, unknown>),
        }),
      ),
      claimOauthSessionByState: jest.fn(),
      findOauthSessionById: jest.fn().mockResolvedValue(authorizedSession),
      updateOauthSession: jest.fn().mockResolvedValue(null),
      createIntegrationAccount: jest
        .fn()
        .mockResolvedValue({ id: 'account-1' }),
      deleteIntegrationAccount: jest.fn().mockResolvedValue(undefined),
    };

    const encryption = {
      encryptJson: (value: unknown) => `enc(${JSON.stringify(value)})`,
      decryptJson: () => ({ accessToken: 'merchant-token' }),
    } as unknown as CredentialEncryptionService;

    service = new UberEatsOnboardingService(
      new ConfigService(env),
      http as unknown as UberEatsHttpClient,
      adapter as unknown as UberEatsAdapter,
      encryption,
      repo as unknown as AggregatorRepository,
    );
  });

  describe('start', () => {
    it('persists a single-use state and returns the consent URL', async () => {
      const result = await service.start('org-1', 'user-1', 'loc-1');

      const session = firstArg<{
        state: string;
        organizationId: string;
        locationId: string;
        expiresAt: Date;
      }>(repo.createOauthSession);
      expect(session.organizationId).toBe('org-1');
      expect(session.locationId).toBe('loc-1');
      expect(session.state).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(http.buildAuthorizeUrl).toHaveBeenCalledWith({
        clientId: 'app-client',
        redirectUri,
        state: session.state,
      });
      expect(result.sessionId).toBe('session-1');
    });
  });

  describe('handleCallback', () => {
    it('never exchanges a code for an unknown, expired, or replayed state', async () => {
      repo.claimOauthSessionByState.mockResolvedValue(null);

      const url = await service.handleCallback({
        code: 'auth-code',
        state: 'stolen-state',
      });

      expect(http.exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(url).toContain('uber_status=invalid_state');
    });

    it('rejects a callback with no state at all', async () => {
      const url = await service.handleCallback({ code: 'auth-code' });
      expect(repo.claimOauthSessionByState).not.toHaveBeenCalled();
      expect(url).toContain('uber_status=invalid_state');
    });

    it('records a merchant denial without failing the request', async () => {
      repo.claimOauthSessionByState.mockResolvedValue({
        id: 'session-1',
        organizationId: 'org-1',
      });

      const url = await service.handleCallback({
        state: 'good-state',
        error: 'access_denied',
      });

      expect(http.exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(repo.updateOauthSession).toHaveBeenCalledWith('session-1', {
        status: 'failed',
        error: 'access_denied',
      });
      expect(url).toContain('uber_status=denied');
    });

    it('exchanges the code, stores the encrypted token and the store list', async () => {
      repo.claimOauthSessionByState.mockResolvedValue({
        id: 'session-1',
        organizationId: 'org-1',
      });

      const url = await service.handleCallback({
        code: 'auth-code',
        state: 'good-state',
      });

      expect(http.exchangeAuthorizationCode).toHaveBeenCalledWith({
        clientId: 'app-client',
        clientSecret: 'app-secret',
        code: 'auth-code',
        redirectUri,
      });
      const update = nthArg<{ status: string; accessToken: string }>(
        repo.updateOauthSession,
        1,
      );
      expect(update.status).toBe('authorized');
      // The raw merchant token must never hit the column in the clear.
      expect(update.accessToken).toBe('enc({"accessToken":"merchant-token"})');
      expect(url).toBe(
        'https://app.coneeko.test/settings?tab=marketplace-integrations' +
          '&uber_status=ok&uber_session=session-1',
      );
    });

    it('marks the session failed when the exchange blows up', async () => {
      repo.claimOauthSessionByState.mockResolvedValue({
        id: 'session-1',
        organizationId: 'org-1',
      });
      http.exchangeAuthorizationCode.mockRejectedValue(new Error('bad code'));

      const url = await service.handleCallback({
        code: 'auth-code',
        state: 'good-state',
      });

      expect(repo.updateOauthSession).toHaveBeenCalledWith('session-1', {
        status: 'failed',
        error: 'bad code',
      });
      expect(url).toContain('uber_status=error');
    });
  });

  describe('listStores', () => {
    it('drops stores with no id and flags the already-integrated ones', async () => {
      repo.findOauthSessionById.mockResolvedValue({
        ...authorizedSession,
        discoveredStores: [
          { store_id: 's1', name: 'Market', pos_data: {} },
          { store_id: 's2', pos_data: { integration_enabled: true } },
          { name: 'no id' },
        ],
      });

      const { stores } = await service.listStores('org-1', 'session-1');

      expect(stores.map((s) => s.storeId)).toEqual(['s1', 's2']);
      expect(stores[0].alreadyIntegrated).toBe(false);
      expect(stores[1].alreadyIntegrated).toBe(true);
    });

    it('refuses a session belonging to another organization', async () => {
      await expect(service.listStores('org-2', 'session-1')).rejects.toThrow(
        'Onboarding session not found.',
      );
    });
  });

  describe('activate', () => {
    it('provisions a granted store and enables webhooks on it', async () => {
      const { results } = await service.activate('org-1', 'session-1', {
        stores: [{ storeId: 'uber-store-1', merchantStoreId: 'Market-01' }],
      });

      expect(repo.createIntegrationAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          providerId: 'prov-uber',
          providerStoreId: 'uber-store-1',
        }),
      );
      expect(adapter.activateStore).toHaveBeenCalledWith(
        'account-1',
        'merchant-token',
        { merchantStoreId: 'Market-01' },
      );
      expect(results).toEqual([
        {
          storeId: 'uber-store-1',
          integrationAccountId: 'account-1',
          activated: true,
        },
      ]);
      // The 30-day provisioning token is dropped once it has done its job.
      expect(repo.updateOauthSession).toHaveBeenCalledWith('session-1', {
        status: 'completed',
        accessToken: null,
        accessTokenExpiresAt: null,
      });
    });

    it('refuses a store id the merchant’s authorization never returned', async () => {
      const { results } = await service.activate('org-1', 'session-1', {
        stores: [{ storeId: 'someone-elses-store' }],
      });

      expect(repo.createIntegrationAccount).not.toHaveBeenCalled();
      expect(adapter.activateStore).not.toHaveBeenCalled();
      expect(results[0]).toEqual({
        storeId: 'someone-elses-store',
        activated: false,
        error: 'Store was not part of this authorization.',
      });
    });

    it('rolls the account back when provisioning fails, so a retry is clean', async () => {
      adapter.activateStore.mockRejectedValue(
        new Error('403 not order manager'),
      );

      const { results } = await service.activate('org-1', 'session-1', {
        stores: [{ storeId: 'uber-store-1' }],
      });

      expect(repo.deleteIntegrationAccount).toHaveBeenCalledWith('account-1');
      expect(results[0].activated).toBe(false);
      expect(results[0].error).toContain('403');
    });

    it('rejects a session that has not been authorized yet', async () => {
      repo.findOauthSessionById.mockResolvedValue({
        ...authorizedSession,
        status: 'pending',
      });

      await expect(
        service.activate('org-1', 'session-1', {
          stores: [{ storeId: 'uber-store-1' }],
        }),
      ).rejects.toThrow('Onboarding session is pending');
    });

    it('rejects an expired merchant authorization', async () => {
      repo.findOauthSessionById.mockResolvedValue({
        ...authorizedSession,
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.activate('org-1', 'session-1', {
          stores: [{ storeId: 'uber-store-1' }],
        }),
      ).rejects.toThrow('expired');
    });
  });
});
