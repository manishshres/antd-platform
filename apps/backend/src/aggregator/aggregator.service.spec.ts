import { AggregatorService } from './aggregator.service';
import { AggregatorRepository } from './database/aggregator.repository';
import { CredentialEncryptionService } from './core/services/credential-encryption.service';

/**
 * The location id on an integration account arrives from the client, and inbound
 * marketplace orders inherit it — so it decides which kitchen a stranger's order prints
 * in. These cover that it is always proven to belong to the caller's organization.
 */
describe('AggregatorService — location binding', () => {
  let service: AggregatorService;
  let repo: {
    findIntegrationAccountById: jest.Mock;
    findProviderByName: jest.Mock;
    createIntegrationAccount: jest.Mock;
    setIntegrationAccountStatus: jest.Mock;
  };
  /** Rows the mocked `db.select(...).from(...).where(...).limit(1)` chain resolves to. */
  let locationRows: { id: string }[];

  beforeEach(() => {
    locationRows = [];
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(locationRows),
    };
    const db = { select: () => chain };

    repo = {
      findIntegrationAccountById: jest.fn().mockResolvedValue({
        id: 'acct-1',
        organizationId: 'org-1',
      }),
      findProviderByName: jest.fn().mockResolvedValue({ id: 'prov-1' }),
      createIntegrationAccount: jest.fn().mockResolvedValue({ id: 'acct-1' }),
      setIntegrationAccountStatus: jest
        .fn()
        .mockResolvedValue({ id: 'acct-1' }),
    };

    service = new AggregatorService(
      db as never,
      repo as unknown as AggregatorRepository,
      {} as never,
      {
        encryptJson: () => 'encrypted',
      } as unknown as CredentialEncryptionService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('binds a location the organization owns', async () => {
    locationRows = [{ id: 'loc-1' }];

    await service.updateIntegrationAccount('org-1', 'acct-1', {
      locationId: 'loc-1',
    });

    expect(repo.setIntegrationAccountStatus).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ locationId: 'loc-1' }),
    );
  });

  it('refuses a location belonging to another organization', async () => {
    locationRows = []; // the org-scoped lookup finds nothing

    await expect(
      service.updateIntegrationAccount('org-1', 'acct-1', {
        locationId: 'someone-elses-location',
      }),
    ).rejects.toThrow('Unknown location for this organization.');
    expect(repo.setIntegrationAccountStatus).not.toHaveBeenCalled();
  });

  it('applies the same check when the account is first connected', async () => {
    locationRows = [];

    await expect(
      service.createIntegrationAccount('org-1', {
        providerName: 'ubereats',
        locationId: 'someone-elses-location',
        credentials: { clientId: 'a', clientSecret: 'b' },
      }),
    ).rejects.toThrow('Unknown location for this organization.');
    expect(repo.createIntegrationAccount).not.toHaveBeenCalled();
  });

  it('leaves the binding untouched when no location is supplied', async () => {
    await service.updateIntegrationAccount('org-1', 'acct-1', {
      autoAcceptOrders: false,
    });

    expect(repo.setIntegrationAccountStatus).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ locationId: undefined }),
    );
  });
});
