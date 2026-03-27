import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuthService, IGoogleUser } from './oauth.service';
import { UsersService } from '@/modules/users/users.service';
import { PrismaService } from '@/database/prisma.service';

const mockGoogleUser: IGoogleUser = {
  googleId: 'g123',
  email: 'test@gmail.com',
  firstName: 'Test',
  lastName: 'User',
  picture: 'https://pic.url',
};

const mockUser = {
  id: 'u1',
  email: 'test@gmail.com',
  username: 'test_abc',
  role: 'CUSTOMER',
  provider: 'LOCAL',
  googleId: null,
};

describe('OAuthService', () => {
  let service: OAuthService;
  let usersService: Record<string, jest.Mock>;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let jwtService: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      findByGoogleId: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      createOAuthUser: jest.fn(),
      updateRefreshToken: jest.fn(),
      updateLastLogin: jest.fn(),
    };
    prisma = { user: { update: jest.fn() } };
    jwtService = { signAsync: jest.fn() };

    jwtService.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt')
                return {
                  secret: 's',
                  expiresIn: '15m',
                  refreshSecret: 'rs',
                  refreshExpiresIn: '7d',
                };
              if (key === 'app') return { frontendUrl: 'http://test.com' };
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(OAuthService);
  });

  describe('handleGoogleLogin', () => {
    it('should return existing user found by Google ID', async () => {
      usersService.findByGoogleId.mockResolvedValue(mockUser);

      const result = await service.handleGoogleLogin(mockGoogleUser);

      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.isNewUser).toBe(false);
      expect(result.redirectUrl).toContain('http://test.com/auth/oauth-callback#accessToken=');
    });

    it('should link Google account to existing local user', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, googleId: 'g123' });

      const result = await service.handleGoogleLogin(mockGoogleUser);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ googleId: 'g123', emailVerified: true }),
        }),
      );
      expect(result.isNewUser).toBe(false);
    });

    it('should throw when existing user already has Google provider', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, provider: 'GOOGLE' });

      await expect(service.handleGoogleLogin(mockGoogleUser)).rejects.toThrow(
        'Account already linked to a different Google account',
      );
    });

    it('should create new OAuth user when no match found', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createOAuthUser.mockResolvedValue({ id: 'new1' });
      usersService.findById.mockResolvedValue({
        ...mockUser,
        id: 'new1',
        provider: 'GOOGLE',
        googleId: 'g123',
      });

      const result = await service.handleGoogleLogin(mockGoogleUser);

      expect(usersService.createOAuthUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@gmail.com',
          googleId: 'g123',
          avatar: 'https://pic.url',
        }),
      );
      expect(result.isNewUser).toBe(true);
    });

    it('should generate tokens and update refresh token', async () => {
      usersService.findByGoogleId.mockResolvedValue(mockUser);

      await service.handleGoogleLogin(mockGoogleUser);

      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith('u1', expect.any(String));
      expect(usersService.updateLastLogin).toHaveBeenCalledWith('u1');
    });

    it('should build redirect URL with tokens in fragment', async () => {
      usersService.findByGoogleId.mockResolvedValue(mockUser);

      const result = await service.handleGoogleLogin(mockGoogleUser);

      expect(result.redirectUrl).toContain('#accessToken=access-token&refreshToken=refresh-token');
    });
  });

  describe('getFrontendErrorUrl', () => {
    it('should map "already linked" error to account_exists code', () => {
      const url = service.getFrontendErrorUrl('Account already linked');
      expect(url).toBe('http://test.com/auth/oauth-error?error=account_exists');
    });

    it('should map unknown errors to oauth_failed code', () => {
      const url = service.getFrontendErrorUrl('Something went wrong');
      expect(url).toBe('http://test.com/auth/oauth-error?error=oauth_failed');
    });
  });
});
