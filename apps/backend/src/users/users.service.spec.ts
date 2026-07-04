/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DRIZZLE } from '../database/database.module';
import { AuditService } from '../common/services/audit.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('UsersService', () => {
  let service: UsersService;
  let dbMock: any;
  let auditServiceMock: any;

  beforeEach(async () => {
    const mockQueryBuilder = (result: any) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
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
      query: {
        users: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
    };

    auditServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DRIZZLE, useValue: dbMock },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Queries', () => {
    it('findOneByEmail should return user if found', async () => {
      const user = { id: 'u1', email: 'test@test.com' };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([user]),
      });

      const result = await service.findOneByEmail('test@test.com');
      expect(result).toEqual(user);
    });

    it('listAllUsersGlobal should return paginated list', async () => {
      const users = [{ id: 'u1' }];
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          offset: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve(users),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve([{ total: 1 }]),
        });

      const result = await service.listAllUsersGlobal({ limit: 10, offset: 0 });
      expect(result.data).toEqual(users);
      expect(result.total).toBe(1);
    });
  });

  describe('Mutations', () => {
    it('createUserGlobal should hash password and create user', async () => {
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([]), // No existing user
      });

      const createdUser = { id: 'u1', email: 'new@test.com' };
      dbMock.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([createdUser]),
      });

      const result = await service.createUserGlobal({
        email: 'new@test.com',
        password: 'password123',
        role: 'user',
        firstName: 'John',
        lastName: 'Doe',
        organizationId: 'org-1',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(result.id).toBe('u1');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('createUserGlobal should throw ConflictException if email exists', async () => {
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([{ id: 'u1' }]), // User exists
      });

      await expect(
        service.createUserGlobal({
          email: 'test@example.com',
          password: 'password123',
          role: 'sysadmin',
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Password Management', () => {
    it('changeMyPassword should update password if old password is valid', async () => {
      const user = { id: 'u1', passwordHash: 'old_hashed' };
      dbMock.query.users.findFirst.mockResolvedValueOnce(user);
      dbMock.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([]),
      });

      await service.changeMyPassword('u1', {
        currentPassword: 'old',
        newPassword: 'new',
      });

      expect(bcrypt.compare).toHaveBeenCalledWith('old', 'old_hashed');
      expect(bcrypt.hash).toHaveBeenCalledWith('new', 12);
      expect(dbMock.update).toHaveBeenCalled();
    });

    it('changeMyPassword should throw UnauthorizedException if old password invalid', async () => {
      const user = { id: 'u1', passwordHash: 'old_hashed' };
      dbMock.query.users.findFirst.mockResolvedValueOnce(user);

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.changeMyPassword('u1', {
          currentPassword: 'wrong',
          newPassword: 'new',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Deletions', () => {
    it('deleteUserGlobal should soft delete user', async () => {
      const user = { id: 'u1', role: 'user' };
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([user]),
      });
      dbMock.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve([]),
      });

      await service.deleteUserGlobal('u1');

      expect(dbMock.update).toHaveBeenCalled();
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.delete' }),
      );
    });
  });
});
