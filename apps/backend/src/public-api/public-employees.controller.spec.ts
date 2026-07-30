import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PublicEmployeesController } from './public-employees.controller';
import { UsersService } from '../users/users.service';
import { DRIZZLE } from '../database/database.module';
import { AuditService } from '../common/services/audit.service';

describe('PublicEmployeesController', () => {
  let controller: PublicEmployeesController;
  let usersService: {
    findOneByEmail: jest.Mock;
    verifyManagerPin: jest.Mock;
  };

  const orgId = 'org-123';
  const baseUser = {
    id: 'user-1',
    email: 'alice@coneeko.test',
    role: 'manager',
    firstName: 'Alice',
    lastName: 'Aardvark',
    organizationId: orgId,
    locationId: 'loc-1',
  };

  beforeEach(async () => {
    usersService = {
      findOneByEmail: jest.fn(),
      verifyManagerPin: jest.fn(),
    };

    const mod: TestingModule = await Test.createTestingModule({
      // The PIN routes carry @PinThrottle(), which binds ApiKeyThrottlerGuard and so
      // needs the throttler's module options present even in a unit test.
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [PublicEmployeesController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: DRIZZLE, useValue: {} },
        { provide: AuditService, useValue: { fireAndForget: jest.fn() } },
      ],
    }).compile();

    controller = mod.get(PublicEmployeesController);
  });

  function reqWithOrg() {
    return { organizationId: orgId } as unknown as import('express').Request & {
      organizationId: string;
    };
  }

  it('signs an employee in when the PIN matches', async () => {
    usersService.findOneByEmail.mockResolvedValue(baseUser);
    usersService.verifyManagerPin.mockResolvedValue(baseUser);

    const res = await controller.authByPin(reqWithOrg(), {
      email: baseUser.email,
      pin: '1234',
    });

    expect(res.id).toBe(baseUser.id);
    expect(res.displayName).toBe('Alice Aardvark');
    expect(res.isManager).toBe(true);
    expect(usersService.verifyManagerPin).toHaveBeenCalledWith(
      orgId,
      '1234',
      baseUser.id,
    );
  });

  it('throws when no user is found for the email', async () => {
    usersService.findOneByEmail.mockResolvedValue(null);

    await expect(
      controller.authByPin(reqWithOrg(), {
        email: 'nobody@coneeko.test',
        pin: '1234',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the user belongs to a different org', async () => {
    usersService.findOneByEmail.mockResolvedValue({
      ...baseUser,
      organizationId: 'other-org',
    });

    await expect(
      controller.authByPin(reqWithOrg(), {
        email: baseUser.email,
        pin: '1234',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when verifyManagerPin returns null', async () => {
    usersService.findOneByEmail.mockResolvedValue(baseUser);
    usersService.verifyManagerPin.mockResolvedValue(null);

    await expect(
      controller.authByPin(reqWithOrg(), {
        email: baseUser.email,
        pin: '9999',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when verifyManagerPin returns a different user', async () => {
    usersService.findOneByEmail.mockResolvedValue(baseUser);
    usersService.verifyManagerPin.mockResolvedValue({
      ...baseUser,
      id: 'other',
    });

    await expect(
      controller.authByPin(reqWithOrg(), {
        email: baseUser.email,
        pin: '1234',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('marks non-manager roles as isManager=false', async () => {
    usersService.findOneByEmail.mockResolvedValue({
      ...baseUser,
      role: 'user',
    });
    usersService.verifyManagerPin.mockResolvedValue({
      ...baseUser,
      role: 'user',
    });
    const res = await controller.authByPin(reqWithOrg(), {
      email: baseUser.email,
      pin: '1234',
    });
    expect(res.isManager).toBe(false);
  });

  it('verifyManagerPin passes candidateEmployeeId through', async () => {
    usersService.verifyManagerPin.mockResolvedValue(baseUser);
    const res = await controller.verifyManagerPin(reqWithOrg(), {
      pin: '4321',
      candidateEmployeeId: baseUser.id,
    });
    expect(res.id).toBe(baseUser.id);
    expect(usersService.verifyManagerPin).toHaveBeenCalledWith(
      orgId,
      '4321',
      baseUser.id,
    );
  });

  it('verifyManagerPin throws when PIN is wrong', async () => {
    usersService.verifyManagerPin.mockResolvedValue(null);
    await expect(
      controller.verifyManagerPin(reqWithOrg(), { pin: '0000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
