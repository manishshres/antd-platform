import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

describe('JwtStrategy', () => {
  const mockUsersService = {
    findOneById: jest.fn(),
  } as unknown as UsersService;

  const makeConfig = (secret: string | undefined): ConfigService =>
    ({ get: jest.fn().mockReturnValue(secret) }) as unknown as ConfigService;

  describe('constructor — JWT_SECRET guard (#27)', () => {
    it('throws when JWT_SECRET is not configured', () => {
      expect(() => new JwtStrategy(makeConfig(undefined), mockUsersService)).toThrow(
        /JWT_SECRET is not configured/,
      );
    });

    it('throws when JWT_SECRET is an empty string', () => {
      expect(() => new JwtStrategy(makeConfig(''), mockUsersService)).toThrow(
        /JWT_SECRET is not configured/,
      );
    });

    it('constructs when JWT_SECRET is present', () => {
      expect(
        () => new JwtStrategy(makeConfig('a-real-secret'), mockUsersService),
      ).not.toThrow();
    });
  });
});
