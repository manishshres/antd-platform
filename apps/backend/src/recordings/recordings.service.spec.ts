import { Test, TestingModule } from '@nestjs/testing';
import { RecordingsService } from './recordings.service';
import { BillingService } from '../billing/billing.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../common/services/audit.service';
import { getQueueToken } from '@nestjs/bullmq';
import { DRIZZLE } from '../database/database.module';
import { NotFoundException } from '@nestjs/common';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

describe('RecordingsService', () => {
  let service: RecordingsService;
  let billingService: Partial<BillingService>;
  let storageService: Partial<StorageService>;
  let auditService: Partial<AuditService>;
  let queue: { add: jest.Mock };
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
    billingService = {
      getRequiredOrg: jest.fn().mockResolvedValue('org-1'),
    };
    storageService = {
      getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/audio.wav'),
    };
    auditService = {
      fireAndForget: jest.fn(),
    };
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    db = {
      select: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingsService,
        { provide: DRIZZLE, useValue: db },
        { provide: BillingService, useValue: billingService },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: auditService },
        { provide: getQueueToken('recordings-queue'), useValue: queue },
      ],
    }).compile();

    service = module.get<RecordingsService>(RecordingsService);
  });

  describe('syncRecording', () => {
    it('throws NotFoundException if location is not found', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      await expect(
        service.syncRecording(mockUser, 'rec-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('enqueues recording import if location exists', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([{ id: 'loc-1' }]),
          }),
        }),
      });

      const res = await service.syncRecording(mockUser, 'rec-123', 'loc-1');
      expect(res.message).toBe('Sync queued successfully');
      expect(queue.add).toHaveBeenCalledWith('import', {
        callSessionId: 'rec-123',
        recordingId: 'rec-123',
        organizationId: 'org-1',
        locationId: 'loc-1',
      });
    });
  });

  describe('listRecordings', () => {
    it('returns paginated recordings with signed URLs and total count', async () => {
      const mockRecordings = [
        {
          id: 'rec-1',
          objectKey: 'recordings/org-1/loc-1/s1.wav',
          createdAt: new Date(),
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

      const result = await service.listRecordings(mockUser, { offset: 0, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.data[0]).toHaveProperty('downloadUrl', 'https://s3.example.com/audio.wav');
    });
  });

  describe('getRecording', () => {
    it('throws NotFoundException if recording does not exist', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      await expect(service.getRecording(mockUser, 'rec-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns recording details with signed URL', async () => {
      const rec = { id: 'rec-1', objectKey: 'key1' };
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([rec]),
          }),
        }),
      });

      const result = await service.getRecording(mockUser, 'rec-1');
      expect(result.id).toBe('rec-1');
      expect(result.downloadUrl).toBe('https://s3.example.com/audio.wav');
    });
  });

  describe('deleteRecording', () => {
    it('soft deletes a recording and logs audit event', async () => {
      const deletedRec = { id: 'rec-1', deletedAt: new Date() };
      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            returning: jest.fn().mockResolvedValueOnce([deletedRec]),
          }),
        }),
      });

      const res = await service.deleteRecording(mockUser, 'rec-1');
      expect(res.success).toBe(true);
      expect(auditService.fireAndForget).toHaveBeenCalled();
    });
  });

  describe('exportRecording', () => {
    it('exports recording as txt format', async () => {
      const rec = {
        id: 'rec-1',
        callSessionId: 'sess-1',
        createdAt: new Date(),
        durationMs: 12000,
        sentiment: 'positive',
        callOutcome: 'Order Placed',
        aiSummary: 'Customer placed an order.',
        transcript: 'Hello, I want pizza.',
      };

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([rec]),
          }),
        }),
      });

      const result = await service.exportRecording(mockUser, 'rec-1', 'txt');
      expect(result.filename).toBe('transcript_rec-1.txt');
      expect(result.contentType).toBe('text/plain');
      expect(result.data).toContain('--- AI Summary ---');
    });

    it('exports recording as csv format by default', async () => {
      const rec = {
        id: 'rec-1',
        callSessionId: 'sess-1',
        createdAt: new Date(),
        durationMs: 12000,
        sentiment: 'positive',
        callOutcome: 'Order Placed',
        aiSummary: 'Customer placed an order.',
        transcript: 'Hello, I want pizza.',
      };

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([rec]),
          }),
        }),
      });

      const result = await service.exportRecording(mockUser, 'rec-1', 'csv');
      expect(result.filename).toBe('transcript_rec-1.csv');
      expect(result.contentType).toBe('text/csv');
      expect(result.data).toContain('Call Session ID,Date,Duration (ms)');
    });
  });
});
