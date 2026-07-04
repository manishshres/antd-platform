import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsService } from './audit-logs.service';

import { DRIZZLE } from '../database/database.module';

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        {
          provide: DRIZZLE,
          useValue: {
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockResolvedValue([{ id: 'log-1' }]),
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
