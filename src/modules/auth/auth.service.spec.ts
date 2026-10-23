import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { hashToken } from '@/common/utils';
import { AuthService } from './auth.service';
import { UsersService } from '@/modules/users/users.service';
import { EmailVerificationService } from './services';
import { REFRESH_SESSION_REPOSITORY } from '@/database/repositories';
import {
  InvalidCredentialsException,
  EmailNotVerifiedException,
  InvalidTokenException,
  AccountSuspendedException,
} from '@/common/exceptions/domain.exception';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: typeof mockUsersService;
  let jwtService: typeof mockJwtService;
  let emailVerificationService: typeof mockEmailVerificationService;
  let refreshSessionRepo: typeof mockRefreshSessionRepo;

  let hashedPassword: string;
  const rawPassword = 'Password1!';
  const rawRefreshToken = 'real-refresh-token';
  const futureExp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        JWT_SECRET: 'test-secret-key-that-is-long-enough',
        JWT_EXPIRES_IN: '1h',
        JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return config[key];
    }),
  };

  const mockUsersService = {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    updateLastLogin: jest.fn(),
    remove: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
    decode: jest.fn().mockReturnValue({ exp: futureExp }),
  };

  const mockEmailVerificationService = {
    sendVerificationEmailByUserId: jest.fn().mockResolvedValue(undefined),
  };

  const mockRefreshSessionRepo = {
    create: jest.fn(),
    findActiveByTokenHash: jest.fn(),
    revokeByTokenHash: jest.fn(),
    revokeAllForUser: jest.fn(),
    rotate: jest.fn(),
  };

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(rawPassword, 12);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('mock-jwt-token');
    mockJwtService.decode.mockReturnValue({ exp: futureExp });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailVerificationService, useValue: mockEmailVerificationService },
        { provide: REFRESH_SESSION_REPOSITORY, useValue: mockRefreshSessionRepo },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = mockUsersService;
    jwtService = mockJwtService;
    emailVerificationService = mockEmailVerificationService;
    refreshSessionRepo = mockRefreshSessionRepo;
  });

  const createMockUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'user-1',
    username: 'johndoe',
    email: 'john@example.com',
    password: hashedPassword,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    emailVerified: true,
    createdAt: new Date('2024-01-15T10:30:00.000Z'),
    updatedAt: new Date('2024-01-15T10:30:00.000Z'),
    ...overrides,
  });

  const createUserDto = {
    username: 'johndoe',
    email: 'john@example.com',
    password: rawPassword,
  };

  describe('register', () => {
    it('should create user, generate tokens, create a session, and send verification email', async () => {
      const mockCreatedUser = {
        id: 'user-1',
        username: 'johndoe',
        email: 'john@example.com',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      usersService.create.mockResolvedValue(mockCreatedUser);
      refreshSessionRepo.create.mockResolvedValue({});

      const result = await authService.register(createUserDto);

      expect(result).toBeDefined();
      expect(result.user).toEqual(mockCreatedUser);
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe('mock-jwt-token');
      expect(result.tokens.refreshToken).toBe('mock-jwt-token');

      expect(usersService.create).toHaveBeenCalledWith(createUserDto);
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(refreshSessionRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        tokenHash: hashToken('mock-jwt-token'),
        expiresAt: new Date(futureExp * 1000),
      });
      // Verification email is fire-and-forget, but service should be called
      // Use a small delay to allow the promise chain to execute
      await new Promise((resolve) => setImmediate(resolve));
      expect(emailVerificationService.sendVerificationEmailByUserId).toHaveBeenCalledWith(
        'user-1',
        'john@example.com',
        'johndoe',
      );
    });

    it('should roll back user creation when token generation fails', async () => {
      const mockCreatedUser = {
        id: 'user-1',
        username: 'johndoe',
        email: 'john@example.com',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      usersService.create.mockResolvedValue(mockCreatedUser);
      jwtService.signAsync.mockRejectedValueOnce(new Error('JWT signing failed'));
      usersService.remove.mockResolvedValue(undefined);

      await expect(authService.register(createUserDto)).rejects.toThrow('JWT signing failed');

      expect(usersService.create).toHaveBeenCalledWith(createUserDto);
      expect(usersService.remove).toHaveBeenCalledWith('user-1', true);
    });
  });

  describe('login', () => {
    it('should return tokens and create a session for valid credentials', async () => {
      const mockUser = createMockUser();
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      refreshSessionRepo.create.mockResolvedValue({});

      const loginDto = { email: 'john@example.com', password: rawPassword };
      const result = await authService.login(loginDto);

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe('mock-jwt-token');
      expect(result.tokens.refreshToken).toBe('mock-jwt-token');

      expect(usersService.findByEmail).toHaveBeenCalledWith('john@example.com');
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      // Bug #12: login must only INSERT this device's session, never touch
      // any other device's row.
      expect(refreshSessionRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        tokenHash: hashToken('mock-jwt-token'),
        expiresAt: new Date(futureExp * 1000),
      });
      expect(refreshSessionRepo.revokeAllForUser).not.toHaveBeenCalled();
      expect(usersService.updateLastLogin).toHaveBeenCalledWith('user-1');
    });

    it('should throw InvalidCredentialsException when user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const loginDto = { email: 'unknown@example.com', password: rawPassword };

      await expect(authService.login(loginDto)).rejects.toThrow(InvalidCredentialsException);

      expect(usersService.findByEmail).toHaveBeenCalledWith('unknown@example.com');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidCredentialsException when password is null (OAuth user)', async () => {
      const oauthUser = createMockUser({ password: null });
      usersService.findByEmail.mockResolvedValue(oauthUser);

      const loginDto = { email: 'john@example.com', password: rawPassword };

      await expect(authService.login(loginDto)).rejects.toThrow(InvalidCredentialsException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidCredentialsException when password is wrong', async () => {
      const mockUser = createMockUser();
      usersService.findByEmail.mockResolvedValue(mockUser);

      const loginDto = { email: 'john@example.com', password: 'WrongPassword1!' };

      await expect(authService.login(loginDto)).rejects.toThrow(InvalidCredentialsException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw EmailNotVerifiedException when email not verified', async () => {
      const unverifiedUser = createMockUser({ emailVerified: false });
      usersService.findByEmail.mockResolvedValue(unverifiedUser);

      const loginDto = { email: 'john@example.com', password: rawPassword };

      await expect(authService.login(loginDto)).rejects.toThrow(EmailNotVerifiedException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw AccountSuspendedException when the account is suspended', async () => {
      const suspendedUser = createMockUser({ status: 'SUSPENDED' });
      usersService.findByEmail.mockResolvedValue(suspendedUser);

      const loginDto = { email: 'john@example.com', password: rawPassword };

      await expect(authService.login(loginDto)).rejects.toThrow(AccountSuspendedException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(refreshSessionRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes only the current session when a refresh token is given', async () => {
      await authService.logout('user-1', rawRefreshToken);

      expect(refreshSessionRepo.revokeByTokenHash).toHaveBeenCalledWith(
        hashToken(rawRefreshToken),
        'user-1',
      );
      expect(refreshSessionRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('revokes every session when no refresh token is given', async () => {
      await authService.logout('user-1');

      expect(refreshSessionRepo.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(refreshSessionRepo.revokeByTokenHash).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    it('rotates the matching session in place and returns new tokens', async () => {
      const mockUser = createMockUser();
      const session = {
        id: 'session-1',
        userId: 'user-1',
        tokenHash: hashToken(rawRefreshToken),
      };
      usersService.findById.mockResolvedValue(mockUser);
      refreshSessionRepo.findActiveByTokenHash.mockResolvedValue(session);
      refreshSessionRepo.rotate.mockResolvedValue({});

      const result = await authService.refreshTokens('user-1', rawRefreshToken);

      expect(result).toBeDefined();
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBe('mock-jwt-token');

      expect(usersService.findById).toHaveBeenCalledWith('user-1');
      expect(refreshSessionRepo.findActiveByTokenHash).toHaveBeenCalledWith(
        hashToken(rawRefreshToken),
      );
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(refreshSessionRepo.rotate).toHaveBeenCalledWith(
        'session-1',
        hashToken(rawRefreshToken),
        hashToken('mock-jwt-token'),
        new Date(futureExp * 1000),
      );
    });

    it('should throw InvalidTokenException when user not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        InvalidTokenException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw AccountSuspendedException when the account was suspended after the session was created', async () => {
      const suspendedUser = createMockUser({ status: 'SUSPENDED' });
      usersService.findById.mockResolvedValue(suspendedUser);

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        AccountSuspendedException,
      );

      expect(refreshSessionRepo.findActiveByTokenHash).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenException when no active session matches the token', async () => {
      const mockUser = createMockUser();
      usersService.findById.mockResolvedValue(mockUser);
      refreshSessionRepo.findActiveByTokenHash.mockResolvedValue(null);

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        InvalidTokenException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenException when the matching session belongs to a different user', async () => {
      const mockUser = createMockUser();
      usersService.findById.mockResolvedValue(mockUser);
      refreshSessionRepo.findActiveByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'someone-else',
        tokenHash: hashToken(rawRefreshToken),
      });

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        InvalidTokenException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenException when the session was revoked or rotated concurrently', async () => {
      const mockUser = createMockUser();
      const session = {
        id: 'session-1',
        userId: 'user-1',
        tokenHash: hashToken(rawRefreshToken),
      };
      usersService.findById.mockResolvedValue(mockUser);
      refreshSessionRepo.findActiveByTokenHash.mockResolvedValue(session);
      // Conditional rotate found the row already changed (logout or a
      // concurrent refresh of this same token won the race) — null means
      // "lost the race", not "crashed".
      refreshSessionRepo.rotate.mockResolvedValue(null);

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        InvalidTokenException,
      );
    });
  });

  describe('two logins in quick succession', () => {
    it('signs distinct refresh tokens (via a jti nonce) even in the same second', async () => {
      // Bug: HS256 is deterministic and {sub, email, role, iat, exp} are
      // identical for two logins in the same wall-clock second, so without
      // a per-token nonce the signed tokens — and therefore their
      // RefreshSession.tokenHash — would collide on the unique constraint.
      const mockUser = createMockUser();
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      refreshSessionRepo.create.mockResolvedValue({});

      const refreshPayloads: Array<{ jti?: string }> = [];
      let callCount = 0;
      jwtService.signAsync.mockImplementation(async (payload: { jti?: string }) => {
        callCount += 1;
        // Every odd call is the access token, every even call the refresh
        // token (see generateTokens' Promise.all order).
        if (callCount % 2 === 0) {
          refreshPayloads.push(payload);
        }
        return `mock-jwt-token-${callCount}`;
      });

      const loginDto = { email: 'john@example.com', password: rawPassword };
      await authService.login(loginDto);
      await authService.login(loginDto);

      expect(refreshPayloads).toHaveLength(2);
      expect(refreshPayloads[0].jti).toBeDefined();
      expect(refreshPayloads[1].jti).toBeDefined();
      expect(refreshPayloads[0].jti).not.toBe(refreshPayloads[1].jti);
    });
  });
});
