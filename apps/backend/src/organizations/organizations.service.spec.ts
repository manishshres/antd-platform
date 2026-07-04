/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service';
import { DRIZZLE } from '../database/database.module';
import { AuditService } from '../common/services/audit.service';
import { NotFoundException } from '@nestjs/common';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let dbMock: any;
  let auditServiceMock: any;

  beforeEach(async () => {
    const mockQueryBuilder = (result: any) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
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
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: DRIZZLE, useValue: dbMock },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Queries', () => {
    it('getMyOrganization should return organization if found', async () => {
      const org = { id: 'org-1', name: 'Test Org' };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([org]),
      });

      const result = await service.getMyOrganization('org-1');
      expect(result).toEqual(org);
    });

    it('getMyOrganization should throw NotFoundException if not found', async () => {
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([]),
      });

      await expect(service.getMyOrganization('org-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('listAllOrganizationsGlobal should return paginated list', async () => {
      const orgs = [{ id: 'org-1' }];
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          offset: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve(orgs),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([{ total: 1 }]),
        });

      const result = await service.listAllOrganizationsGlobal({
        limit: 10,
        offset: 0,
      });
      expect(result.data).toEqual(orgs);
      expect(result.total).toBe(1);
    });
  });

  describe('Mutations', () => {
    it('createOrganizationGlobal should generate slug and create org', async () => {
      const newOrg = { id: 'org-1', name: 'My Bakery', slug: 'my-bakery-abcd' };
      dbMock.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([newOrg]),
      });

      const result = await service.createOrganizationGlobal({
        name: 'My Bakery',
      });

      expect(dbMock.insert).toHaveBeenCalled();
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.create' }),
      );
      expect(result).toEqual(newOrg);
    });

    it('updateMyOrganization should update properties', async () => {
      const org = { id: 'org-1', name: 'Old Name' };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([org]),
      });

      const updatedOrg = { id: 'org-1', name: 'New Name' };
      dbMock.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([updatedOrg]),
      });

      const result = await service.updateMyOrganization('org-1', {
        name: 'New Name',
      });

      expect(result).toEqual(updatedOrg);
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.update' }),
      );
    });

    it('updateFeatureFlags should merge new flags with old flags', async () => {
      const org = { id: 'org-1', featureFlags: { ai: true, webhooks: false } };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([org]),
      });

      const updatedOrg = {
        id: 'org-1',
        featureFlags: { ai: true, webhooks: true, newFlag: true },
      };
      dbMock.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([updatedOrg]),
      });

      const result = await service.updateFeatureFlags('org-1', {
        flags: { webhooks: true, newFlag: true },
      });

      expect(result).toEqual(updatedOrg);
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'org.feature_flags.updated' }),
      );
    });

    it('updateOrganizationGlobal should update properties like updateMyOrganization', async () => {
      const org = { id: 'org-1', name: 'Old Name' };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([org]),
      });

      const updatedOrg = { id: 'org-1', name: 'Global Name' };
      dbMock.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([updatedOrg]),
      });

      const result = await service.updateOrganizationGlobal('org-1', {
        name: 'Global Name',
      });

      expect(result).toEqual(updatedOrg);
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.update' }),
      );
    });
  });

  describe('Deletions', () => {
    it('deleteOrganizationGlobal should soft delete organization', async () => {
      const org = { id: 'org-1', name: 'To Delete' };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([org]),
      });

      dbMock.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([]),
      });

      await service.deleteOrganizationGlobal('org-1');

      expect(dbMock.update).toHaveBeenCalled();
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.delete' }),
      );
    });
  });
});
