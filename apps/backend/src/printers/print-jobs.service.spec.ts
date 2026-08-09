import { Test, TestingModule } from '@nestjs/testing';
import { PrintJobsService } from './print-jobs.service';
import { EventsGateway } from '../events/events.gateway';
import { getQueueToken } from '@nestjs/bullmq';
import { DRIZZLE } from '../database/database.module';

describe('PrintJobsService', () => {
  let service: PrintJobsService;
  let eventsGateway: Partial<EventsGateway>;
  let printQueue: { add: jest.Mock };
  let db: any;

  beforeEach(async () => {
    eventsGateway = {
      emitToOrganization: jest.fn(),
    };
    printQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    db = {
      insert: jest.fn(),
      select: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintJobsService,
        { provide: DRIZZLE, useValue: db },
        { provide: EventsGateway, useValue: eventsGateway },
        { provide: getQueueToken('print-queue'), useValue: printQueue },
      ],
    }).compile();

    service = module.get<PrintJobsService>(PrintJobsService);
  });

  describe('createPrintJob', () => {
    it('creates a print job, emits gateway event, and enqueues to BullMQ', async () => {
      const createdJob = {
        id: 'pj-1',
        organizationId: 'org-1',
        jobType: 'receipt',
        status: 'queued',
        attempts: 0,
        payload: { ticket: 1 },
      };

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValueOnce({
          returning: jest.fn().mockResolvedValueOnce([createdJob]),
        }),
      });

      const res = await service.createPrintJob({
        organizationId: 'org-1',
        jobType: 'receipt',
        payload: { ticket: 1 },
      });

      expect(res).toEqual(createdJob);
      expect(eventsGateway.emitToOrganization).toHaveBeenCalledWith(
        'org-1',
        'printJob.created',
        createdJob,
      );
      expect(printQueue.add).toHaveBeenCalledWith(
        'print-job',
        expect.objectContaining({
          orgId: 'org-1',
          type: 'receipt',
          printJobId: 'pj-1',
        }),
        expect.any(Object),
      );
    });
  });

  describe('getPrintJob', () => {
    it('returns print job matching id and optional organizationId', async () => {
      const job = { id: 'pj-1', organizationId: 'org-1' };
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([job]),
          }),
        }),
      });

      const res = await service.getPrintJob('pj-1', 'org-1');
      expect(res).toEqual(job);
    });
  });

  describe('updatePrintJobStatus', () => {
    it('updates print job status in database', async () => {
      const updatedJob = { id: 'pj-1', organizationId: 'org-1', status: 'sent' };
      const returningMock = jest.fn().mockResolvedValue([updatedJob]);
      const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
      const setMock = jest.fn().mockReturnValue({ where: whereMock });
      db.update.mockReturnValue({ set: setMock });

      const res = await service.updatePrintJobStatus('pj-1', 'sent');
      expect(res).toEqual(updatedJob);
    });
  });
});
