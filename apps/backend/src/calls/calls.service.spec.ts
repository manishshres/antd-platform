import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service';
import { StorageService } from '../storage/storage.service';
import { ExportService } from '../export/export.service';
import { DRIZZLE } from '../database/database.module';
import { NotFoundException } from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

describe('CallsService', () => {
  let service: CallsService;
  let storageService: Partial<StorageService>;
  let exportService: Partial<ExportService>;
  let db: any;

  const mockUser: CurrentUserPayload = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'manager',
    organizationId: 'org-1',
    isPlatformAdmin: false,
    emailVerifiedAt: new Date(),
  };

  beforeEach(async () => {
    storageService = {
      getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/audio.wav'),
      getObjectStream: jest.fn().mockResolvedValue({} as any),
    };
    exportService = {
      exportCsv: jest.fn().mockReturnValue('ID,Date,From,To\n1,2026-08-01,+15551234,+15555678'),
      exportExcel: jest.fn().mockResolvedValue(Buffer.from('excel-data')),
    };

    db = {
      select: jest.fn(),
      query: {
        recordings: {
          findFirst: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storageService },
        { provide: ExportService, useValue: exportService },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  describe('listCalls', () => {
    it('returns empty array if org scope cannot be resolved', async () => {
      const userWithoutOrg: CurrentUserPayload = {
        ...mockUser,
        organizationId: null,
        isPlatformAdmin: false,
      };

      const result = await service.listCalls(userWithoutOrg, { offset: 0, limit: 20 });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns paginated calls for organization', async () => {
      const mockRecordings = [
        {
          id: 'call-1',
          fromNumber: '+15551234',
          toNumber: '+15555678',
          durationMs: 45000,
          status: 'uploaded',
          createdAt: new Date(),
          objectKey: 'recordings/org-1/loc-1/c1.wav',
          callSessionId: 'sess-1',
          aiSummary: 'Summary text',
          sentiment: 'positive',
          callOutcome: 'Question Answered',
          tags: [],
        },
      ];

      db.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest.fn().mockReturnValueOnce({
              orderBy: jest.fn().mockReturnValueOnce({
                limit: jest.fn().mockReturnValueOnce({
                  offset: jest.fn().mockResolvedValueOnce(mockRecordings),
                }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest.fn().mockResolvedValueOnce([{ total: 1 }]),
          }),
        });

      const result = await service.listCalls(mockUser, { offset: 0, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('call-1');
      expect(result.data[0].recordingUrl).toBe('https://s3.example.com/audio.wav');
    });
  });

  describe('getCall', () => {
    it('throws NotFoundException if organizationId is missing', async () => {
      await expect(service.getCall('call-1', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns call detail when found', async () => {
      const rec = {
        id: 'call-1',
        fromNumber: '+15551234',
        toNumber: '+15555678',
        durationMs: 45000,
        status: 'uploaded',
        createdAt: new Date(),
        objectKey: 'recordings/org-1/loc-1/c1.wav',
        callSessionId: 'sess-1',
        aiSummary: 'Summary text',
        sentiment: 'positive',
        callOutcome: 'Question Answered',
        tags: [],
      };

      db.query.recordings.findFirst.mockResolvedValueOnce(rec);

      const result = await service.getCall('call-1', 'org-1');
      expect(result.id).toBe('call-1');
      expect(result.recordingUrl).toBe('https://s3.example.com/audio.wav');
    });
  });

  describe('exportCallsCsv', () => {
    it('throws NotFoundException if organizationId is null', async () => {
      await expect(service.exportCallsCsv(null)).rejects.toThrow(NotFoundException);
    });

    it('exports call logs as CSV string', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            orderBy: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      const csv = await service.exportCallsCsv('org-1');
      expect(csv).toContain('ID,Date,From,To');
    });
  });
});
