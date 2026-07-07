import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { DRIZZLE } from '../database/database.module';
import { BillingService } from '../billing/billing.service';

describe('CustomersService', () => {
  let service: CustomersService;

  const mockDb = { select: jest.fn(), insert: jest.fn(), update: jest.fn() };
  const mockBillingService = { getRequiredOrg: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
