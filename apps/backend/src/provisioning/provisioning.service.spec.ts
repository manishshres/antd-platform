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
};

const mockAuditService = {
  log: jest.fn(),
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
      expect(mockAuditService.log).toHaveBeenCalledWith({
        action: 'org.created',
        organizationId: 'org-1',
      });
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
      expect(mockAuditService.log).toHaveBeenCalledWith({
        action: 'org.deprovisioned',
        organizationId: 'org-1',
      });
    });
  });
});
