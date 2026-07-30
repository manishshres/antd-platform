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
      fireAndForget: jest.fn(),
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
      expect(auditServiceMock.fireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.delete' }),
      );
    });
  });

  describe('verifyManagerPin — actingUserId fast path (#10)', () => {
    const managerRow = {
      id: 'mgr-1',
      organizationId: 'org-1',
      role: 'manager',
      posPinHash: 'hashed_pin',
    };

    const stubSelect = (result: any) =>
      dbMock.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve(result),
      });

    it('validates only the acting user and returns them on a PIN match', async () => {
      stubSelect([managerRow]);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.verifyManagerPin('org-1', '1234', 'mgr-1');

      expect(result).toMatchObject({ id: 'mgr-1' });
      // Fast path issues a single scoped lookup rather than scanning every manager.
      expect(dbMock.select).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('returns null when the acting user PIN does not match', async () => {
      stubSelect([managerRow]);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const result = await service.verifyManagerPin('org-1', '9999', 'mgr-1');

      expect(result).toBeNull();
    });

    it('returns null (no bcrypt compare) when the acting user is not an eligible manager', async () => {
      stubSelect([]); // no row matched the id + org + manager-role + pin-hash filter

      const result = await service.verifyManagerPin('org-1', '1234', 'ghost');

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    /**
     * N3. A 4-digit PIN is 10,000 guesses and the PIN routes used to skip throttling
     * entirely, so an authenticated junior session could walk the whole space.
     */
    describe('brute-force protection', () => {
      it('counts a wrong PIN against the user and audit-logs the failure', async () => {
        stubSelect([{ ...managerRow, posPinFailedAttempts: 0 }]);
        (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

        const result = await service.verifyManagerPin('org-1', '9999', 'mgr-1');

        expect(result).toBeNull();
        // The failure is persisted (atomic increment) …
        expect(dbMock.update).toHaveBeenCalled();
        // … and recorded for the audit trail.
        expect(auditServiceMock.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'pos.pin.verify_failed',
            entityId: 'mgr-1',
            newValue: { reason: 'wrong_pin' },
          }),
        );
      });

      it('rejects a locked-out user without ever comparing the PIN', async () => {
        const lockedUntil = new Date(Date.now() + 10 * 60_000);
        stubSelect([
          {
            ...managerRow,
            posPinFailedAttempts: 5,
            posPinLockedUntil: lockedUntil,
          },
        ]);

        const result = await service.verifyManagerPin('org-1', '1234', 'mgr-1');

        expect(result).toBeNull();
        // Short-circuits before bcrypt — a locked PIN cannot be tested at all.
        expect(bcrypt.compare).not.toHaveBeenCalled();
        expect(auditServiceMock.log).toHaveBeenCalledWith(
          expect.objectContaining({ newValue: { reason: 'locked_out' } }),
        );
      });

      it('accepts the PIN again once the lockout has expired', async () => {
        stubSelect([
          {
            ...managerRow,
            posPinFailedAttempts: 5,
            posPinLockedUntil: new Date(Date.now() - 60_000), // already elapsed
          },
        ]);
        (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

        const result = await service.verifyManagerPin('org-1', '1234', 'mgr-1');

        expect(result).toMatchObject({ id: 'mgr-1' });
      });

      it('skips locked-out managers in the org-wide branch', async () => {
        // Dropping candidateEmployeeId must not be a way around the lockout.
        stubSelect([
          {
            ...managerRow,
            posPinLockedUntil: new Date(Date.now() + 10 * 60_000),
          },
        ]);

        const result = await service.verifyManagerPin('org-1', '1234');

        expect(result).toBeNull();
        expect(bcrypt.compare).not.toHaveBeenCalled();
      });
    });
  });

  describe('setPosPin — per-org uniqueness (N3)', () => {
    const stubSelectSequence = (...results: any[]) => {
      for (const result of results) {
        dbMock.select.mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve(result),
        });
      }
    };

    it('rejects a PIN already used by another employee in the org', async () => {
      stubSelectSequence(
        [{ organizationId: 'org-1' }], // the target user
        [{ id: 'mgr-2', posPinHash: 'someone_elses_hash' }], // peers holding PINs
      );
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true); // collides

      // Duplicate PINs make the org-wide branch attribute an override to the wrong
      // manager, which corrupts the audit trail.
      await expect(service.setPosPin('mgr-1', '1234')).rejects.toThrow(
        ConflictException,
      );
      expect(dbMock.update).not.toHaveBeenCalled();
    });

    it('allows a PIN no one else in the org holds', async () => {
      stubSelectSequence(
        [{ organizationId: 'org-1' }],
        [{ id: 'mgr-2', posPinHash: 'someone_elses_hash' }],
      );
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false); // no collision

      await service.setPosPin('mgr-1', '4321');

      expect(bcrypt.hash).toHaveBeenCalledWith('4321', 12);
      expect(dbMock.update).toHaveBeenCalled();
    });

    it('ignores the user’s own existing PIN when checking for collisions', async () => {
      stubSelectSequence(
        [{ organizationId: 'org-1' }],
        [{ id: 'mgr-1', posPinHash: 'my_own_current_hash' }], // only self
      );

      await service.setPosPin('mgr-1', '1234');

      // Self is skipped before bcrypt — re-setting your own PIN must not self-collide.
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(dbMock.update).toHaveBeenCalled();
    });
  });
});
