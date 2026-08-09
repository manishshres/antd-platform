import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from './agents.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { DRIZZLE } from '../database/database.module';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('AgentsService', () => {
  let service: AgentsService;
  let telnyxService: Partial<TelnyxService>;
  let db: any;

  beforeEach(async () => {
    telnyxService = {
      getAssistants: jest.fn().mockResolvedValue({
        data: [
          { id: 'ast-1', name: 'Front Desk AI', status: 'active', created_at: '2026-01-01' },
          { id: 'ast-2', name: 'Order Taker AI', status: 'active', created_at: '2026-01-02' },
        ],
      }),
      getAssistant: jest.fn().mockResolvedValue({
        id: 'ast-1',
        name: 'Front Desk AI',
        status: 'active',
      }),
      updateAssistant: jest.fn().mockResolvedValue({
        id: 'ast-1',
        name: 'Updated Front Desk AI',
        status: 'active',
      }),
    };

    db = {
      select: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: DRIZZLE, useValue: db },
        { provide: TelnyxService, useValue: telnyxService },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  describe('listAgents', () => {
    it('returns empty array when orgId is null', async () => {
      const res = await service.listAgents(null);
      expect(res).toEqual([]);
    });

    it('returns agents mapped from orgAgents and locations table', async () => {
      // 1st select: orgAgents table
      db.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest.fn().mockResolvedValueOnce([{ externalId: 'ast-1' }]),
          }),
        })
        // 2nd select: locations table
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest.fn().mockResolvedValueOnce([{ assistantId: 'ast-2' }]),
          }),
        });

      const res = await service.listAgents('org-1');
      expect(res.length).toBe(2);
      expect(res[0].id).toBe('ast-1');
      expect(res[1].id).toBe('ast-2');
      expect(res[0]).not.toHaveProperty('created_at'); // White-label check: camelCase createdAt
      expect(res[0].createdAt).toBe('2026-01-01');
    });

    it('returns empty array if org has no associated agents', async () => {
      db.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest.fn().mockResolvedValueOnce([]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest.fn().mockResolvedValueOnce([]),
          }),
        });

      const res = await service.listAgents('org-1');
      expect(res).toEqual([]);
    });
  });

  describe('getAgent', () => {
    it('throws ForbiddenException if agent does not belong to org', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([]),
        }),
      });

      await expect(service.getAgent('ast-999', 'org-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns white-labeled agent DTO when authorized', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([{ externalId: 'ast-1' }]),
        }),
      });

      const res = await service.getAgent('ast-1', 'org-1');
      expect(res.id).toBe('ast-1');
      expect(res.name).toBe('Front Desk AI');
    });
  });

  describe('updateLocationAgent', () => {
    it('throws ForbiddenException if organizationId is missing', async () => {
      await expect(
        service.updateLocationAgent('loc-1', {}, null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if location is not found', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      await expect(
        service.updateLocationAgent('loc-1', {}, 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates location assistant via Telnyx API', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([{ telnyxAssistantId: 'ast-1' }]),
          }),
        }),
      });

      const res = await service.updateLocationAgent(
        'loc-1',
        { name: 'Updated Front Desk AI' },
        'org-1',
      );

      expect(res.id).toBe('ast-1');
      expect(res.name).toBe('Updated Front Desk AI');
      expect(telnyxService.updateAssistant).toHaveBeenCalledWith('ast-1', {
        name: 'Updated Front Desk AI',
      });
    });
  });
});
