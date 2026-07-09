/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksManagementService } from './webhooks-management.service';
import { DRIZZLE } from '../database/database.module';
import { AuditService } from '../common/services/audit.service';
import { NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('abcd', 'hex')),
}));

describe('WebhooksManagementService', () => {
  let service: WebhooksManagementService;
  let dbMock: any;
  let auditServiceMock: any;

  beforeEach(async () => {
    const mockQueryBuilder = (result: any) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue(result),
        delete: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve(result),
      };
      return qb;
    };

    dbMock = {
      select: jest.fn(() => mockQueryBuilder([])),
      insert: jest.fn(() => mockQueryBuilder([{ id: 'wh-1' }])),
      delete: jest.fn(() => mockQueryBuilder([{ id: 'wh-1' }])),
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
      fireAndForget: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksManagementService,
        { provide: DRIZZLE, useValue: dbMock },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    }).compile();

    service = module.get<WebhooksManagementService>(WebhooksManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listEndpoints', () => {
    it('should list webhook endpoints for an organization', async () => {
      const mockWebhooks = [{ id: 'wh-1', url: 'https://test.com' }];
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockWebhooks),
      });

      const result = await service.listEndpoints('org-1');
      expect(result).toEqual(mockWebhooks);
      expect(dbMock.select).toHaveBeenCalled();
    });
  });

  describe('createEndpoint', () => {
    it('should create a new webhook endpoint and return it', async () => {
      const dto = {
        url: 'https://example.com/webhook',
        events: ['order.created'],
      };
      const newWebhook = {
        id: 'wh-1',
        organizationId: 'org-1',
        url: dto.url,
        events: dto.events,
        isActive: true,
        secret: '61626364', // hex of 'abcd' buffer mocked
      };

      dbMock.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([newWebhook]),
      });

      const result = await service.createEndpoint('org-1', dto);

      expect(result).toEqual(newWebhook);
      expect(crypto.randomBytes).toHaveBeenCalledWith(32);
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith({
        action: 'org.webhook.created',
        organizationId: 'org-1',
        entityId: 'wh-1',
        entityType: 'org_webhooks',
        newValue: { url: dto.url, events: dto.events },
      });
    });
  });

  describe('deleteEndpoint', () => {
    it('should delete a webhook and create an audit log', async () => {
      const deletedWebhook = { id: 'wh-1', url: 'https://example.com' };
      dbMock.delete.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([deletedWebhook]),
      });

      const result = await service.deleteEndpoint('org-1', 'wh-1');
      expect(result).toEqual({ message: 'Webhook deleted successfully.' });
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith({
        action: 'org.webhook.deleted',
        organizationId: 'org-1',
        entityId: 'wh-1',
        entityType: 'org_webhooks',
        previousValue: { url: deletedWebhook.url },
      });
    });

    it('should throw NotFoundException if webhook does not exist', async () => {
      dbMock.delete.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([]),
      });

      await expect(service.deleteEndpoint('org-1', 'wh-999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
