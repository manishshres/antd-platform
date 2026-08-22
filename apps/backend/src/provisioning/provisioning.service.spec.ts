import { Test, TestingModule } from '@nestjs/testing';
import { ProvisioningService } from './provisioning.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AuditService } from '../common/services/audit.service';
import { getQueueToken } from '@nestjs/bullmq';
import { DRIZZLE } from '../database/database.module';

const mockDb = {
  transaction: jest.fn(),
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
};

const mockTelnyxService = {
  deletePhoneNumber: jest.fn(),
  deleteAssistant: jest.fn(),
  getAssistant: jest.fn(),
  getPhoneNumbersByConnection: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  fireAndForget: jest.fn(),
};

const mockProvisioningQueue = {
  add: jest.fn(),
};

describe('ProvisioningService', () => {
  let service: ProvisioningService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: TelnyxService, useValue: mockTelnyxService },
        { provide: AuditService, useValue: mockAuditService },
        {
          provide: getQueueToken('provisioning-queue'),
          useValue: mockProvisioningQueue,
        },
      ],
    }).compile();

    service = module.get<ProvisioningService>(ProvisioningService);
    jest.clearAllMocks();
    // clearAllMocks leaves queued `mockResolvedValueOnce` values in place, so a test that
    // throws before consuming one would leak it into the next test. Reset the query
    // terminator explicitly and restore its chaining behaviour.
    mockDb.where.mockReset().mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrganizationProvisioning', () => {
    it('should start provisioning and enqueue a job', async () => {
      mockDb.transaction.mockImplementation(() => {
        return Promise.resolve({
          organizationId: 'org-1',
          locationId: 'loc-1',
        });
      });

      const result = await service.createOrganizationProvisioning({
        orgName: 'Test Org',
        locationName: 'Test Location',
        adminEmail: 'admin@test.com',
        country: 'US',
        state: 'NY',
        city: 'New York',
      });

      expect(result.organizationId).toBe('org-1');
      expect(result.locationId).toBe('loc-1');
      expect(mockProvisioningQueue.add).toHaveBeenCalledWith(
        'provision-organization',
        {
          organizationId: 'org-1',
          locationId: 'loc-1',
          adminEmail: 'admin@test.com',
        },
        { jobId: 'provision-loc-1' },
      );
      expect(mockAuditService.fireAndForget).toHaveBeenCalledWith({
        action: 'org.created',
        organizationId: 'org-1',
      });
    });
  });

  describe('createOrganizationProvisioning — reusing the agent phone number', () => {
    /**
     * Runs the real transaction callback against a tx spy so the generated step list can be
     * asserted. Returns every row inserted into org_provisioning_steps.
     */
    const runWithStepCapture = async (
      dto: Parameters<
        ProvisioningService['createOrganizationProvisioning']
      >[0],
    ) => {
      const insertedSteps: string[] = [];
      const tx = {
        insert: jest.fn().mockImplementation((table: unknown) => ({
          values: jest.fn().mockImplementation((row: { stepName?: string }) => {
            if (row.stepName) insertedSteps.push(row.stepName);
            return {
              returning: jest
                .fn()
                .mockResolvedValue([{ id: 'org-1', organizationId: 'org-1' }]),
            };
          }),
          returning: jest.fn().mockResolvedValue([{ id: 'org-1' }]),
        })),
      };
      // The org/location inserts read `.returning()` off `.values()`.
      tx.insert.mockImplementation(() => ({
        values: jest.fn().mockImplementation((row: { stepName?: string }) => {
          if (row.stepName) insertedSteps.push(row.stepName);
          return {
            returning: jest.fn().mockResolvedValue([{ id: 'loc-1' }]),
          };
        }),
      }));

      mockDb.transaction.mockImplementation(
        async (cb: (t: typeof tx) => Promise<unknown>) => {
          await cb(tx);
          return { organizationId: 'org-1', locationId: 'loc-1' };
        },
      );

      const result = await service.createOrganizationProvisioning(dto);
      return { result, insertedSteps };
    };

    const baseDto = {
      orgName: 'Test Org',
      locationName: 'Test Location',
      adminEmail: 'admin@test.com',
      country: 'US',
      baseAgentId: 'asst-base',
      useAgentPhoneNumber: true,
    };

    beforeEach(() => {
      mockTelnyxService.getAssistant.mockResolvedValue({
        telephony_settings: { default_texml_app_id: 'texml-1' },
      });
      mockTelnyxService.getPhoneNumbersByConnection.mockResolvedValue({
        data: [{ id: 'phone-1', phone_number: '+15550001111' }],
      });
      // No location has claimed the number.
      mockDb.where.mockResolvedValueOnce([]);
    });

    it('omits the search and purchase steps so no number is bought', async () => {
      const { insertedSteps } = await runWithStepCapture(baseDto);

      expect(insertedSteps).not.toContain('search_phone_number');
      expect(insertedSteps).not.toContain('purchase_phone_number');
      expect(insertedSteps[0]).toBe('clone_agent');
      expect(insertedSteps).toContain('assign_phone_to_agent');
    });

    it('keeps the purchase steps when the flag is off', async () => {
      const { insertedSteps } = await runWithStepCapture({
        ...baseDto,
        useAgentPhoneNumber: false,
      });

      expect(insertedSteps[0]).toBe('search_phone_number');
      expect(insertedSteps[1]).toBe('purchase_phone_number');
    });

    it('rejects the request when the number already backs another location', async () => {
      // Drop the "unclaimed" result the describe-level beforeEach queued.
      mockDb.where.mockReset().mockReturnThis();
      mockProvisioningQueue.add.mockClear();
      mockDb.where.mockResolvedValueOnce([
        {
          locationId: 'loc-existing',
          locationName: 'Existing Diner',
          phoneNumber: '+15550001111',
        },
      ]);

      await expect(
        service.createOrganizationProvisioning(baseDto),
      ).rejects.toThrow(/already assigned to "Existing Diner"/);
      expect(mockProvisioningQueue.add).not.toHaveBeenCalled();
    });

    it('requires a base agent to reuse a number from', async () => {
      await expect(
        service.createOrganizationProvisioning({
          ...baseDto,
          baseAgentId: undefined,
        }),
      ).rejects.toThrow(/baseAgentId is required/);
    });
  });

  describe('deprovision', () => {
    it('should delete Telnyx resources and archive org/location', async () => {
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'loc-1',
          telnyxPhoneNumberId: 'phone-1',
          telnyxAssistantId: 'asst-1',
        },
      ]);

      await service.deprovision('org-1');

      expect(mockTelnyxService.deletePhoneNumber).toHaveBeenCalledWith(
        'phone-1',
      );
      expect(mockTelnyxService.deleteAssistant).toHaveBeenCalledWith('asst-1');
      expect(mockDb.update).toHaveBeenCalledTimes(2); // one for org, one for location
      expect(mockAuditService.fireAndForget).toHaveBeenCalledWith({
        action: 'org.deprovisioned',
        organizationId: 'org-1',
      });
    });

    it('keeps a number that was reused from the base agent', async () => {
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'loc-1',
          telnyxPhoneNumberId: 'phone-1',
          telnyxAssistantId: 'asst-1',
          aiSettings: { useAgentPhoneNumber: true },
        },
      ]);

      await service.deprovision('org-1');

      expect(mockTelnyxService.deletePhoneNumber).not.toHaveBeenCalled();
      // The cloned assistant is still disposable — only the number is shared.
      expect(mockTelnyxService.deleteAssistant).toHaveBeenCalledWith('asst-1');
    });
  });
});
