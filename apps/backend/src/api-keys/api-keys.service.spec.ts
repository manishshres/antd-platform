import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from './api-keys.service';
import { DRIZZLE } from '../database/database.module';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../common/services/audit.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: DRIZZLE,
          useValue: {},
        },
        {
          provide: BillingService,
          useValue: {},
        },
        {
          provide: AuditService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: { get: () => undefined },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
