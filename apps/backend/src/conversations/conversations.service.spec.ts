import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { DRIZZLE } from '../database/database.module';
import { BillingService } from '../billing/billing.service';

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockDb = { select: jest.fn(), from: jest.fn() };
  const mockBillingService = { getRequiredOrg: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
