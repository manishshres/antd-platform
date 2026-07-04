import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { MailService } from '../common/services/mail.service';
import { AuditService } from '../common/services/audit.service';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: 'inv-1' }]),
  delete: jest.fn().mockReturnThis(),
};

const mockMailService = {
  sendOrganizationInvitation: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
};

const mockUsersService = {
  findOneByEmail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockAuthService = {
  hashPassword: jest.fn().mockResolvedValue('hashed-pass'),
  login: jest.fn().mockResolvedValue({ accessToken: 'token' }),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('http://localhost:3000'),
};

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: MailService, useValue: mockMailService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvitation', () => {
    it('should generate a token and send an email', async () => {
      mockUsersService.findOneByEmail.mockResolvedValueOnce(null);
      mockDb.limit.mockResolvedValueOnce([{ id: 'org-1', name: 'Test Org' }]); // for org lookup

      const result = await service.createInvitation('org-1', 'inviter-1', {
        email: 'test@example.com',
        role: 'manager',
      });

      expect(result.message).toBe('Invitation sent.');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockMailService.sendOrganizationInvitation).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        'Test Org',
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.invitation.sent',
          organizationId: 'org-1',
        }),
      );
    });
  });

  describe('acceptInvitation', () => {
    it('should throw if token is invalid or expired', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // token not found
      await expect(
        service.acceptInvitation({
          token: 'invalid-token',
          password: 'pass',
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+1234567890',
        }),
      ).rejects.toThrow('Invalid invitation token');
    });

    it('should create a user and mark token as used', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'inv-1',
          email: 'test@example.com',
          role: 'manager',
          status: 'pending',
          organizationId: 'org-1',
          locationId: null,
          expiresAt: new Date(Date.now() + 100000), // future
        },
      ]);
      mockUsersService.findOneByEmail.mockResolvedValueOnce(null);
      mockUsersService.create.mockResolvedValueOnce({ id: 'user-1' });

      const dto = {
        token: 'valid-token',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '+1234567890',
      };
      const result = await service.acceptInvitation(dto);

      expect(result.message).toBeDefined();
      expect(mockUsersService.create).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const expectedDate: Date = expect.any(Date);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({
        status: 'accepted',
        acceptedAt: expectedDate,
      });
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'invitation.accept',
          organizationId: 'org-1',
          userId: 'user-1',
        }),
      );
    });
  });
});
