import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const mockAuthService = {};
  const mockConfigService = { get: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  describe('register — self-registration gate (#22)', () => {
    it('throws ForbiddenException when SELF_REGISTRATION_ENABLED is off', () => {
      mockConfigService.get.mockReturnValue(false);

      expect(() => controller.register({} as never)).toThrow(
        ForbiddenException,
      );
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'SELF_REGISTRATION_ENABLED',
        false,
      );
    });

    it('does not throw when SELF_REGISTRATION_ENABLED is on', () => {
      mockConfigService.get.mockReturnValue(true);

      const result = controller.register({} as never);

      expect(result).toBeDefined();
    });
  });
});
