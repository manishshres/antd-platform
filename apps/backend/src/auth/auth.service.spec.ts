import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../common/services/mail.service';
import { AuditService } from '../common/services/audit.service';
import { DRIZZLE } from '../database/database.module';
import * as bcrypt from 'bcrypt';
import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;

  const mockUsersService = {
    findOneByEmail: jest.fn(),
    findOneById: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
      if (key === 'JWT_REFRESH_EXPIRATION') return 604800;
      return defaultValue;
    }),
  };

  const mockMailService = {
    sendPasswordReset: jest.fn(),
    sendEmailVerification: jest.fn(),
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  const mockDb = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 'test-id' }]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MailService, useValue: mockMailService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: DRIZZLE, useValue: mockDb },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should throw ForbiddenException since self-registration is disabled', async () => {
      await expect(
        service.register(
          'test@test.com',
          'hash',
          'John',
          'Doe',
          'Company',
          '12345',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateUser', () => {
    it('should return null if user does not exist', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue(null);
      const result = await service.validateUser('test@test.com', 'password');
      expect(result).toBeNull();
    });

    it('should throw HttpException if account is locked', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        lockedUntil: new Date(Date.now() + 10000), // Locked in the future
      });

      await expect(
        service.validateUser('test@test.com', 'password'),
      ).rejects.toThrow(HttpException);
    });

    it('should return user object if password is valid', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        role: 'admin',
        organizationId: 'org-1',
        passwordHash: 'hashedpass',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@test.com', 'password');

      expect(result).toEqual({
        id: 'user-1',
        email: 'test@test.com',
        role: 'admin',
        organizationId: 'org-1',
        emailVerifiedAt: null,
      });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should increment failed login attempts on invalid password', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: 'hashedpass',
        failedLoginAttempts: 1,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('test@test.com', 'wrongpass');

      expect(result).toBeNull();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ failedLoginAttempts: expect.anything() }),
      );
    });
  });

  describe('login', () => {
    it('should return access and refresh tokens', async () => {
      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const user = {
        id: 'user-1',
        email: 'test@test.com',
        role: 'admin',
      };

      const result = await service.login(user);

      expect(result.access_token).toBe('access-token');
      expect(result.refresh_token).toBe('refresh-token');
      expect(result.user.id).toBe('user-1');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login', userId: 'user-1' }),
      );
    });
  });

  describe('refresh', () => {
    it('should throw UnauthorizedException for invalid token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should detect reuse and revoke all sessions when token not found in db', async () => {
      // Valid signature but the hash is absent → the token was already rotated away (reuse).
      mockJwtService.verify.mockReturnValue({ sub: 'user-1' });
      mockDb.limit.mockResolvedValue([]); // No token found

      await expect(service.refresh('valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
      // Family revocation: all of the user's refresh tokens are deleted.
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should refresh tokens successfully', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-1' });
      mockDb.limit.mockResolvedValue([
        {
          expiresAt: new Date(Date.now() + 10000), // Valid expiration
        },
      ]);
      mockUsersService.findOneById.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        role: 'admin',
      });
      mockJwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');

      const result = await service.refresh('valid-token');

      expect(result.access_token).toBe('new-access-token');
      expect(result.refresh_token).toBe('new-refresh-token');
      expect(mockDb.delete).toHaveBeenCalled(); // Should delete old token
      expect(mockDb.insert).toHaveBeenCalled(); // Should insert new token
    });
  });

  describe('logout', () => {
    it('should delete the refresh token', async () => {
      const result = await service.logout('refresh-token');
      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });
});
