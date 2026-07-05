import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { DRIZZLE } from '../database/database.module';
import { BillingService } from '../billing/billing.service';
import { TelnyxService } from '../telnyx/telnyx.service';

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockDb = { select: jest.fn(), from: jest.fn() };
  const mockBillingService = { getRequiredOrg: jest.fn() };
  const mockTelnyxService = {
    getConversations: jest.fn(),
    getConversationMessages: jest.fn(),
    getRecordings: jest.fn(),
  };
  const mockRecordingsQueue = { add: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: BillingService, useValue: mockBillingService },
        { provide: TelnyxService, useValue: mockTelnyxService },
        {
          provide: getQueueToken('recordings-queue'),
          useValue: mockRecordingsQueue,
        },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
