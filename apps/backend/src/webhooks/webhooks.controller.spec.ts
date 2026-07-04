import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { DRIZZLE } from '../database/database.module';
import { getQueueToken } from '@nestjs/bullmq';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';

describe('WebhooksController', () => {
  let controller: WebhooksController;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn(),
  };

  const mockWebhookQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
  };

  // Default: no TELNYX_PUBLIC_KEY and non-production → signature check is skipped,
  // matching the AI-order tests which don't exercise the Telnyx path.
  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: DRIZZLE, useValue: mockDb },
        { provide: getQueueToken('webhook-queue'), useValue: mockWebhookQueue },
        {
          provide: getQueueToken('recordings-queue'),
          useValue: mockWebhookQueue,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ApiKeyThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WebhooksController>(WebhooksController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleAiOrder', () => {
    it('should throw UnauthorizedException if API key is missing', async () => {
      await expect(
        controller.handleAiOrder('', {
          customerName: 'A',
          customerPhone: '1',
          items: [],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if API key is invalid', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // Organization not found
      await expect(
        controller.handleAiOrder('invalid-key', {
          customerName: 'A',
          customerPhone: '1',
          items: [],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException if order has no items', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'org-1' }]);
      await expect(
        controller.handleAiOrder('valid-key', {
          customerName: 'A',
          customerPhone: '1',
          items: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enqueue job if valid', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'org-1' }]);
      const res = await controller.handleAiOrder('valid-key', {
        customerName: 'Alice',
        customerPhone: '555-1234',
        items: [{ menuItemId: 'item-1', quantity: 1 }],
      });

      expect(res).toEqual({
        message: 'Order received and accepted for processing.',
        jobId: 'job-123',
      });
      expect(mockWebhookQueue.add).toHaveBeenCalledWith('process-ai-order', {
        orgId: 'org-1',
        customerName: 'Alice',
        customerPhone: '555-1234',
        items: [{ menuItemId: 'item-1', quantity: 1 }],
      });
    });
  });
});
