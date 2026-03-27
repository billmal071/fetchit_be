import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PasswordResetService } from './password-reset.service';
import { UsersService } from '@/modules/users/users.service';
import { EmailService } from '@/jobs/services';
import { PASSWORD_RESET_REPOSITORY } from '@/database/repositories';
import { ERROR_MESSAGES } from '@/common/constants';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let usersService: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let passwordResetRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn() };
    emailService = { sendPasswordResetEmail: jest.fn() };
    passwordResetRepo = {
      invalidateUserTokens: jest.fn(),
      create: jest.fn(),
      findByTokenWithUser: jest.fn(),
      resetPasswordWithToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: UsersService, useValue: usersService },
        { provide: EmailService, useValue: emailService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue({ frontendUrl: 'http://test.com' }) },
        },
        { provide: PASSWORD_RESET_REPOSITORY, useValue: passwordResetRepo },
      ],
    }).compile();

    service = module.get(PasswordResetService);
  });

  describe('requestPasswordReset', () => {
    it('should send reset email for local user', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        username: 'user1',
        provider: 'LOCAL',
      });
      passwordResetRepo.create.mockResolvedValue({});

      await service.requestPasswordReset({ email: 'a@b.com' });

      expect(passwordResetRepo.invalidateUserTokens).toHaveBeenCalledWith('u1');
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('http://test.com/auth/reset-password?token='),
        'user1',
      );
    });

    it('should silently return for non-existent email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await service.requestPasswordReset({ email: 'no@one.com' });
      expect(passwordResetRepo.create).not.toHaveBeenCalled();
    });

    it('should silently return for OAuth user', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        provider: 'GOOGLE',
      });
      await service.requestPasswordReset({ email: 'a@b.com' });
      expect(passwordResetRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const mockReset = {
      id: 'r1',
      token: 'valid',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
      user: { email: 'a@b.com' },
    };

    it('should reset password with valid token', async () => {
      passwordResetRepo.findByTokenWithUser.mockResolvedValue(mockReset);

      await service.resetPassword({
        token: 'valid',
        password: 'NewPass@123',
        confirmPassword: 'NewPass@123',
      });

      expect(passwordResetRepo.resetPasswordWithToken).toHaveBeenCalledWith(
        'r1',
        'u1',
        expect.any(String), // hashed password
      );
    });

    it('should throw when passwords do not match', async () => {
      await expect(
        service.resetPassword({
          token: 'valid',
          password: 'NewPass@123',
          confirmPassword: 'Different@123',
        }),
      ).rejects.toThrow('Passwords do not match');
    });

    it('should throw for invalid token', async () => {
      passwordResetRepo.findByTokenWithUser.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'bad',
          password: 'P@ss1234',
          confirmPassword: 'P@ss1234',
        }),
      ).rejects.toThrow(ERROR_MESSAGES.TOKEN_INVALID);
    });

    it('should throw for already-used token', async () => {
      passwordResetRepo.findByTokenWithUser.mockResolvedValue({
        ...mockReset,
        usedAt: new Date(),
      });

      await expect(
        service.resetPassword({
          token: 'used',
          password: 'P@ss1234',
          confirmPassword: 'P@ss1234',
        }),
      ).rejects.toThrow(ERROR_MESSAGES.TOKEN_ALREADY_USED);
    });

    it('should throw for expired token', async () => {
      passwordResetRepo.findByTokenWithUser.mockResolvedValue({
        ...mockReset,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword({
          token: 'expired',
          password: 'P@ss1234',
          confirmPassword: 'P@ss1234',
        }),
      ).rejects.toThrow(ERROR_MESSAGES.TOKEN_EXPIRED);
    });
  });
});
