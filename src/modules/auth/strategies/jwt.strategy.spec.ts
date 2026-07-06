import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '@/modules/users/users.service';
import { EmailNotVerifiedException } from '@/common/exceptions';
import { IJwtPayload } from '@/common/interfaces';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findById: jest.Mock };

  const payload: IJwtPayload = {
    sub: 'user-1',
    email: 'user@test.com',
    role: 'CUSTOMER',
  } as IJwtPayload;

  const baseUser = {
    id: 'user-1',
    email: 'user@test.com',
    role: 'CUSTOMER',
    status: UserStatus.ACTIVE,
    emailVerified: true,
  };

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue({ secret: 'a'.repeat(32) }),
    } as unknown as ConfigService;
    usersService = { findById: jest.fn() };
    strategy = new JwtStrategy(configService, usersService as unknown as UsersService);
  });

  it('returns the request user when active and email-verified', async () => {
    usersService.findById.mockResolvedValue(baseUser);

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'user-1',
      email: 'user@test.com',
      role: 'CUSTOMER',
    });
  });

  it('throws "User not found" when the user does not exist', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toThrow('User not found');
  });

  it('throws EmailNotVerifiedException (403) for an unverified PENDING user, not a generic 401', async () => {
    usersService.findById.mockResolvedValue({
      ...baseUser,
      status: UserStatus.PENDING,
      emailVerified: false,
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(EmailNotVerifiedException);
  });

  it('throws "User account is not active" for a verified but non-active (e.g. suspended) user', async () => {
    usersService.findById.mockResolvedValue({
      ...baseUser,
      status: UserStatus.SUSPENDED,
      emailVerified: true,
    });

    await expect(strategy.validate(payload)).rejects.toThrow('User account is not active');
  });
});
