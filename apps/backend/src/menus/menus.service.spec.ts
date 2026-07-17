/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { MenusService } from './menus.service';
import { DRIZZLE } from '../database/database.module';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../common/services/audit.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getQueueToken } from '@nestjs/bullmq';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

const userPayload = (overrides: Partial<CurrentUserPayload> = {}): CurrentUserPayload => ({
  id: 'user-1',
  email: 'user@example.com',
  role: 'manager',
  organizationId: 'org-123',
  locationId: null,
  isPlatformAdmin: false,
  ...overrides,
});
import { ConfigService } from '@nestjs/config';

describe('MenusService', () => {
  let service: MenusService;
  let dbMock: any;
  let billingServiceMock: any;
  let auditServiceMock: any;
  let cacheManagerMock: any;
  let importQueueMock: any;

  beforeEach(async () => {
    const mockQueryBuilder = (result: any) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue(result),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve(result),
      };
      return qb;
    };

    dbMock = {
      select: jest.fn(() => mockQueryBuilder([])),
      insert: jest.fn(() => mockQueryBuilder([])),
      update: jest.fn(() => mockQueryBuilder([])),
      transaction: jest.fn((cb: any) => cb(dbMock)),
    };

    billingServiceMock = {
      getRequiredOrg: jest.fn().mockResolvedValue('org-123'),
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
      fireAndForget: jest.fn(),
    };

    cacheManagerMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      store: {
        client: {
          keys: jest.fn().mockResolvedValue([]),
          del: jest.fn().mockResolvedValue(true),
        },
      },
    };

    importQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: jest.fn(),
    };

    const menuAiSyncQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'ai-job-1' }),
      getJob: jest.fn().mockResolvedValue(undefined),
    };

    const telnyxServiceMock = {
      isConfigured: jest.fn().mockReturnValue(false),
      uploadKnowledgeDocument: jest.fn().mockResolvedValue(undefined),
      embedKnowledgeDocuments: jest
        .fn()
        .mockResolvedValue({ data: { id: 'b1' } }),
      createOrUpdateMenuAssistant: jest.fn().mockResolvedValue('assistant-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenusService,
        { provide: DRIZZLE, useValue: dbMock },
        { provide: BillingService, useValue: billingServiceMock },
        { provide: AuditService, useValue: auditServiceMock },
        { provide: CACHE_MANAGER, useValue: cacheManagerMock },
        { provide: getQueueToken('import-queue'), useValue: importQueueMock },
        {
          provide: getQueueToken('menu-ai-sync-queue'),
          useValue: menuAiSyncQueueMock,
        },
        { provide: TelnyxService, useValue: telnyxServiceMock },
        {
          provide: AnalyticsService,
          useValue: { recordUsage: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockImplementation((key, def) => def) },
        },
      ],
    }).compile();

    service = module.get<MenusService>(MenusService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('getMenu', () => {
    it('should return cached menu if available', async () => {
      const cachedData = {
        data: [{ id: 'cat-1', name: 'Drinks', items: [] }],
        total: 1,
        hasMore: false,
      };
      // First get resolves the version stamp (null → 0); second is the data key.
      cacheManagerMock.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cachedData);

      const result = await service.getMenuByOrg('org-123', {
        offset: 0,
        limit: 10,
      });

      expect(cacheManagerMock.get).toHaveBeenCalledWith(
        'menu:org-123:v0:active:all:0:10',
      );
      expect(dbMock.select).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should fetch from DB and set cache if no cache exists', async () => {
      const mockQueryBuilder = (result: any) => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve(result),
      });

      dbMock.select
        .mockReturnValueOnce(mockQueryBuilder([]))
        .mockReturnValueOnce(mockQueryBuilder([{ total: 0 }]));

      const result = await service.getMenuByOrg('org-123', {
        offset: 0,
        limit: 10,
      });

      expect(cacheManagerMock.get).toHaveBeenCalledWith(
        'menu:org-123:v0:active:all:0:10',
      );
      expect(dbMock.select).toHaveBeenCalledTimes(2);
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'menu:org-123:v0:active:all:0:10',
        { data: [], total: 0, hasMore: false },
        3600000,
      );
      expect(result).toEqual({ data: [], total: 0, hasMore: false });
    });
  });

  describe('Mutations & Cache Invalidation', () => {
    it('createCategory should invalidate cache and create audit log', async () => {
      const newCategory = {
        id: 'cat-1',
        name: 'Desserts',
        organizationId: 'org-123',
      };
      const qb = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([newCategory]),
      };
      dbMock.insert.mockReturnValueOnce(qb);

      const result = await service.createCategory(userPayload(), 'Desserts');

      expect(billingServiceMock.getRequiredOrg).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', organizationId: 'org-123' }),
      );
      expect(dbMock.insert).toHaveBeenCalled();
      // Invalidation bumps the per-org version stamp (no cross-tenant flush / KEYS scan).
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'menu:org-123:ver',
        expect.any(Number),
        expect.any(Number),
      );
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'menu.category.create',
          entityId: 'cat-1',
        }),
      );
      expect(result).toEqual(newCategory);
    });

    it('deleteCategory should invalidate cache', async () => {
      const category = { id: 'cat-1', organizationId: 'org-123' };

      const selectQb = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([category]),
      };
      dbMock.select.mockReturnValueOnce(selectQb);

      await service.deleteCategory(userPayload(), 'cat-1');

      expect(dbMock.transaction).toHaveBeenCalled();
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'menu:org-123:ver',
        expect.any(Number),
        expect.any(Number),
      );
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'menu.category.delete',
          entityId: 'cat-1',
        }),
      );
    });
    it('createMenuItem should invalidate cache and return new item', async () => {
      const qbSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) =>
          resolve([{ id: 'cat-1', organizationId: 'org-123' }]),
      };
      const qbInsert = {
        values: jest.fn().mockReturnThis(),
        returning: jest
          .fn()
          .mockResolvedValue([{ id: 'item-1', name: 'Burger' }]),
      };

      dbMock.select.mockReturnValueOnce(qbSelect);
      dbMock.insert.mockReturnValueOnce(qbInsert);

      const result = await service.createMenuItem(
        userPayload(),
        'cat-1',
        'Burger',
        'Tasty',
        1000,
      );
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'menu.item.create' }),
      );
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'menu:org-123:ver',
        expect.any(Number),
        expect.any(Number),
      );
      expect(result.id).toBe('item-1');
    });

    it('createModifierGroup should invalidate cache', async () => {
      const qbInsert = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 'mod-1', name: 'Size' }]),
      };
      dbMock.insert.mockReturnValueOnce(qbInsert);

      const result = await service.createModifierGroup(userPayload(), 'Size');
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'menu.modifier_group.create' }),
      );
      expect(cacheManagerMock.set).toHaveBeenCalledWith(
        'menu:org-123:ver',
        expect.any(Number),
        expect.any(Number),
      );
      expect(result.id).toBe('mod-1');
    });
  });

  describe('AI Imports', () => {
    it('importFromWebsite should enqueue a job', async () => {
      const user = {
        id: 'user-1',
        email: 'admin@example.com',
        role: 'sysadmin',
        organizationId: 'org-123',
        locationId: null,
        isPlatformAdmin: false,
      };
      const result = await service.importFromWebsite(
        user,
        'https://example.com/menu',
      );

      expect(importQueueMock.add).toHaveBeenCalledWith('import-menu', {
        orgId: 'org-123',
        url: 'https://example.com/menu',
        locationId: null,
        importMode: 'sync',
      });
      expect(result.jobId).toBe('job-123');
      expect(result.success).toBe(true);
    });

    it('getImportJobStatus should return job state', async () => {
      const mockJob = {
        data: { url: 'https://example.com/menu' },
        getState: jest.fn().mockResolvedValue('completed'),
        progress: 100,
        failedReason: null,
        returnvalue: { categories: [] },
        timestamp: 1600000000000,
        processedOn: 1600000005000,
        finishedOn: 1600000010000,
      };
      importQueueMock.getJob.mockResolvedValueOnce(mockJob);

      const result = await service.getImportJobStatus('job-123');

      expect(importQueueMock.getJob).toHaveBeenCalledWith('job-123');
      expect(result.state).toBe('completed');
      expect(result.result).toEqual({ categories: [] });
    });
  });
});
