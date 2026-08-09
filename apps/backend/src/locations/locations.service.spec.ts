import { Test, TestingModule } from '@nestjs/testing';
import { LocationsService } from './locations.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AuditService } from '../common/services/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { DRIZZLE } from '../database/database.module';
import { NotFoundException } from '@nestjs/common';

describe('LocationsService', () => {
  let service: LocationsService;
  let telnyxService: Partial<TelnyxService>;
  let auditService: Partial<AuditService>;
  let invitationsService: Partial<InvitationsService>;
  let db: any;

  beforeEach(async () => {
    telnyxService = {
      updateAssistant: jest.fn().mockResolvedValue({}),
      updateAssistantDynamicVariable: jest.fn().mockResolvedValue({}),
    };
    auditService = {
      fireAndForget: jest.fn(),
    };
    invitationsService = {
      createInvitation: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    };

    db = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: DRIZZLE, useValue: db },
        { provide: TelnyxService, useValue: telnyxService },
        { provide: AuditService, useValue: auditService },
        { provide: InvitationsService, useValue: invitationsService },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
  });

  describe('listLocations', () => {
    it('returns array of locations', async () => {
      const mockLocations = [{ id: 'loc-1', name: 'Main Store' }];
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            orderBy: jest.fn().mockResolvedValueOnce(mockLocations),
          }),
        }),
      });

      const res = await service.listLocations('org-1');
      expect(res).toEqual(mockLocations);
    });
  });

  describe('createLocation', () => {
    it('creates a location and logs audit event', async () => {
      const createdLoc = { id: 'loc-1', name: 'Downtown Branch', slug: 'downtown-branch' };
      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValueOnce({
          returning: jest.fn().mockResolvedValueOnce([createdLoc]),
        }),
      });

      const res = await service.createLocation('org-1', { name: 'Downtown Branch' });
      expect(res).toEqual(createdLoc);
      expect(auditService.fireAndForget).toHaveBeenCalled();
    });
  });

  describe('updateLocation', () => {
    it('throws NotFoundException if location is not found', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      await expect(
        service.updateLocation('org-1', 'loc-999', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates location and maps phone number if provided', async () => {
      const loc = { id: 'loc-1', name: 'Old Name', status: 'draft' };
      const updatedLoc = { id: 'loc-1', name: 'New Name', status: 'active', phoneNumber: '+12025550123' };

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([loc]),
          }),
        }),
      });

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            returning: jest.fn().mockResolvedValueOnce([updatedLoc]),
          }),
        }),
      });

      // orgPhoneNumbers check
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([]),
      });

      const res = await service.updateLocation('org-1', 'loc-1', {
        name: 'New Name',
        phoneNumber: '+12025550123',
      });

      expect(res).toEqual(updatedLoc);
      expect(auditService.fireAndForget).toHaveBeenCalled();
    });
  });

  describe('updateAiConfig', () => {
    it('updates location AI config and syncs with Telnyx if assistant exists', async () => {
      const loc = {
        id: 'loc-1',
        telnyxAssistantId: 'ast-123',
        aiSettings: { dynamicVariables: { greeting: 'Hi' } },
      };

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([loc]),
          }),
        }),
      });

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([]),
        }),
      });

      const res = await service.updateAiConfig('org-1', 'loc-1', {
        aiSettings: { instructions: 'Custom system prompt', dynamicVariables: { key1: 'val1' } },
      });

      expect(res.message).toContain('AI Config updated');
      expect(telnyxService.updateAssistant).toHaveBeenCalledWith('ast-123', {
        instructions: 'Custom system prompt',
      });
    });
  });

  describe('deleteLocation', () => {
    it('deletes location and logs audit event', async () => {
      const loc = { id: 'loc-1', name: 'Branch' };
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([loc]),
          }),
        }),
      });

      db.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValueOnce([]),
      });

      const res = await service.deleteLocation('org-1', 'loc-1');
      expect(res.message).toBe('Location deleted successfully.');
      expect(auditService.fireAndForget).toHaveBeenCalled();
    });
  });
});
