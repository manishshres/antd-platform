import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  WebhookQueueProcessor,
  type WebhookJobData,
  type WebhookJobResult,
} from './webhook-queue.processor';
import { DRIZZLE } from '../../database/database.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as schema from '../../database/schema';

describe('WebhookQueueProcessor', () => {
  let processor: WebhookQueueProcessor;

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn(() => ({ where: updateWhere }));
  const mockDb = {
    update: jest.fn(() => ({ set: updateSet })),
  };

  const mockEventEmitter = {
    // OrdersService listener returns the created order via emitAsync
    emitAsync: jest
      .fn()
      .mockResolvedValue([
        { id: 'order-1', status: 'pending', totalAmount: 1000 },
      ]),
  };

  const mockCacheManager = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const makeJob = (
    data: Partial<WebhookJobData>,
  ): Job<WebhookJobData, WebhookJobResult, string> =>
    ({ data }) as unknown as Job<WebhookJobData, WebhookJobResult, string>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookQueueProcessor,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    processor = module.get<WebhookQueueProcessor>(WebhookQueueProcessor);
    jest.clearAllMocks();
  });

  describe('idempotency-key completion (#12)', () => {
    it('marks the webhook event completed after the order is processed', async () => {
      const result = await processor.process(
        makeJob({
          orgId: 'org-1',
          idempotencyKey: 'idem-123',
          customerName: 'John',
          customerPhone: '1234567890',
          items: [{ menuItemId: 'menu-1', quantity: 1 }],
        }),
      );

      expect(result).toMatchObject({ orderId: 'order-1' });

      // The reservation must move from 'pending' to 'completed' with a processedAt.
      expect(mockDb.update).toHaveBeenCalledWith(schema.webhookEvents);
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          // jest's asymmetric matchers are typed `any`; widen to unknown at the boundary.
          processedAt: expect.any(Date) as unknown,
        }),
      );
    });

    it('does not touch webhook_events when no idempotency key is present', async () => {
      await processor.process(
        makeJob({
          orgId: 'org-1',
          customerName: 'John',
          customerPhone: '1234567890',
          items: [{ menuItemId: 'menu-1', quantity: 1 }],
        }),
      );

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('skips as a duplicate when the idempotency key was already seen in cache', async () => {
      mockCacheManager.get.mockResolvedValueOnce('1');

      const result = await processor.process(
        makeJob({
          orgId: 'org-1',
          idempotencyKey: 'idem-123',
          customerName: 'John',
          customerPhone: '1234567890',
          items: [{ menuItemId: 'menu-1', quantity: 1 }],
        }),
      );

      expect(result).toEqual({ message: 'Skipped duplicate webhook' });
      expect(mockEventEmitter.emitAsync).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
