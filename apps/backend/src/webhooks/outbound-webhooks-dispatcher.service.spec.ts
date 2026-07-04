/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { OutboundWebhooksDispatcherService } from './outbound-webhooks-dispatcher.service';
import { DRIZZLE } from '../database/database.module';
import { getQueueToken } from '@nestjs/bullmq';

describe('OutboundWebhooksDispatcherService', () => {
  let service: OutboundWebhooksDispatcherService;
  let dbMock: any;
  let queueMock: any;

  beforeEach(async () => {
    const mockQueryBuilder = (result: any) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve(result),
      };
      return qb;
    };

    dbMock = {
      select: jest.fn(() => mockQueryBuilder([])),
    };

    queueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboundWebhooksDispatcherService,
        { provide: DRIZZLE, useValue: dbMock },
        {
          provide: getQueueToken('outbound-webhooks-queue'),
          useValue: queueMock,
        },
      ],
    }).compile();

    service = module.get<OutboundWebhooksDispatcherService>(
      OutboundWebhooksDispatcherService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('dispatch', () => {
    it('should enqueue a job for endpoints subscribing to specific event', async () => {
      const mockEndpoints = [
        {
          id: 'ep-1',
          url: 'https://test1.com',
          secret: 'sec1',
          events: ['order.created'],
        },
        {
          id: 'ep-2',
          url: 'https://test2.com',
          secret: 'sec2',
          events: ['order.updated'],
        },
      ];

      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockEndpoints),
      });

      const payload = { orderId: '123' };
      await service.dispatch('org-1', 'order.created', payload);

      expect(queueMock.add).toHaveBeenCalledTimes(1);
      expect(queueMock.add).toHaveBeenCalledWith(
        'dispatch-webhook',
        {
          url: 'https://test1.com',
          secret: 'sec1',
          event: 'order.created',
          payload,
        },
        expect.objectContaining({ attempts: 5 }),
      );
    });

    it('should enqueue a job for endpoints subscribing to wildcard event', async () => {
      const mockEndpoints = [
        { id: 'ep-3', url: 'https://test3.com', secret: 'sec3', events: ['*'] },
      ];

      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockEndpoints),
      });

      const payload = { orderId: '456' };
      await service.dispatch('org-1', 'order.updated', payload);

      expect(queueMock.add).toHaveBeenCalledTimes(1);
      expect(queueMock.add).toHaveBeenCalledWith(
        'dispatch-webhook',
        {
          url: 'https://test3.com',
          secret: 'sec3',
          event: 'order.updated',
          payload,
        },
        expect.any(Object),
      );
    });
  });

  describe('Event Listeners', () => {
    it('handleOrderCreated should call dispatch', async () => {
      const dispatchSpy = jest
        .spyOn(service, 'dispatch')
        .mockResolvedValue(undefined);
      const payload = { orgId: 'org-1', fullOrder: { id: '1' } };

      await service.handleOrderCreated(payload);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'org-1',
        'order.created',
        payload.fullOrder,
      );
    });

    it('handleOrderUpdated should call dispatch', async () => {
      const dispatchSpy = jest
        .spyOn(service, 'dispatch')
        .mockResolvedValue(undefined);
      const payload = { orgId: 'org-1', updatedOrder: { id: '2' } };

      await service.handleOrderUpdated(payload);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'org-1',
        'order.updated',
        payload.updatedOrder,
      );
    });
  });
});
