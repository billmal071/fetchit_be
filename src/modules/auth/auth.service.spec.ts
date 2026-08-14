import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { hashToken } from '@/common/utils';
import { AuthService } from './auth.service';
import { UsersService } from '@/modules/users/users.service';
import { EmailVerificationService } from './services';
import {
  InvalidCredentialsException,
  EmailNotVerifiedException,
  InvalidTokenException,
} from '@/common/exceptions/domain.exception';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: typeof mockUsersService;
  let jwtService: typeof mockJwtService;
  let emailVerificationService: typeof mockEmailVerificationService;

  let hashedPassword: string;
  let hashedRefreshToken: string;
  const rawPassword = 'Password1!';
  const rawRefreshToken = 'real-refresh-token';

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
    updateRefreshToken: jest.fn(),
    updateLastLogin: jest.fn(),
    remove: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
  };

  const mockEmailVerificationService = {
    sendVerificationEmailByUserId: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(rawPassword, 12);
    hashedRefreshToken = hashToken(rawRefreshToken);
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailVerificationService, useValue: mockEmailVerificationService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = mockUsersService;
    jwtService = mockJwtService;
    emailVerificationService = mockEmailVerificationService;
  });

  const createMockUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'user-1',
    username: 'johndoe',
    email: 'john@example.com',
    password: hashedPassword,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    emailVerified: true,
    refreshToken: hashedRefreshToken,
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
    it('should create user, generate tokens, update refresh token, and send verification email', async () => {
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
      usersService.updateRefreshToken.mockResolvedValue(undefined);

      const result = await authService.register(createUserDto);

      expect(result).toBeDefined();
      expect(result.user).toEqual(mockCreatedUser);
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe('mock-jwt-token');
      expect(result.tokens.refreshToken).toBe('mock-jwt-token');

      expect(usersService.create).toHaveBeenCalledWith(createUserDto);
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith('user-1', expect.any(String));
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
    it('should return tokens for valid credentials', async () => {
      const mockUser = createMockUser();
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.updateRefreshToken.mockResolvedValue(undefined);
      usersService.updateLastLogin.mockResolvedValue(undefined);

      const loginDto = { email: 'john@example.com', password: rawPassword };
      const result = await authService.login(loginDto);

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe('mock-jwt-token');
      expect(result.tokens.refreshToken).toBe('mock-jwt-token');

      expect(usersService.findByEmail).toHaveBeenCalledWith('john@example.com');
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith('user-1', expect.any(String));
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
  });

  describe('logout', () => {
    it('should clear refresh token', async () => {
      usersService.updateRefreshToken.mockResolvedValue(undefined);

      await authService.logout('user-1');

      expect(usersService.updateRefreshToken).toHaveBeenCalledWith('user-1', null);
    });
  });

  describe('refreshTokens', () => {
    it('should return new tokens for valid refresh token', async () => {
      const mockUser = createMockUser({ refreshToken: hashedRefreshToken });
      usersService.findById.mockResolvedValue(mockUser);
      usersService.updateRefreshToken.mockResolvedValue(undefined);

      const result = await authService.refreshTokens('user-1', rawRefreshToken);

      expect(result).toBeDefined();
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBe('mock-jwt-token');

      expect(usersService.findById).toHaveBeenCalledWith('user-1');
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(usersService.updateRefreshToken).toHaveBeenCalledWith('user-1', expect.any(String));
    });

    it('should throw InvalidTokenException when user not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        InvalidTokenException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenException when no stored refresh token', async () => {
      const mockUser = createMockUser({ refreshToken: null });
      usersService.findById.mockResolvedValue(mockUser);

      await expect(authService.refreshTokens('user-1', rawRefreshToken)).rejects.toThrow(
        InvalidTokenException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenException when token does not match', async () => {
      const mockUser = createMockUser({ refreshToken: hashedRefreshToken });
      usersService.findById.mockResolvedValue(mockUser);

      await expect(authService.refreshTokens('user-1', 'wrong-refresh-token')).rejects.toThrow(
        InvalidTokenException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
