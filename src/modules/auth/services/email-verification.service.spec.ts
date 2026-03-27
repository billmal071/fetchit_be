import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailVerificationService } from './email-verification.service';
import { UsersService } from '@/modules/users/users.service';
import { EmailService } from '@/jobs/services';
import { EMAIL_VERIFICATION_REPOSITORY } from '@/database/repositories';
import { ERROR_MESSAGES, EVENTS } from '@/common/constants';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let usersService: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;
  let emailVerificationRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), findById: jest.fn() };
    emailService = { sendEmailVerificationEmail: jest.fn() };
    eventEmitter = { emit: jest.fn() };
    emailVerificationRepo = {
      invalidateUserTokens: jest.fn(),
      create: jest.fn(),
      findByTokenWithUser: jest.fn(),
      verifyAndActivateUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: UsersService, useValue: usersService },
        { provide: EmailService, useValue: emailService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue({ frontendUrl: 'http://test.com' }) },
        },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: EMAIL_VERIFICATION_REPOSITORY, useValue: emailVerificationRepo },
      ],
    }).compile();

    service = module.get(EmailVerificationService);
  });

  describe('sendVerificationEmail', () => {
    it('should send email for existing unverified user', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        username: 'user1',
        emailVerified: false,
      });
      emailVerificationRepo.create.mockResolvedValue({});

      await service.sendVerificationEmail('a@b.com');

      expect(emailVerificationRepo.invalidateUserTokens).toHaveBeenCalledWith('u1');
      expect(emailVerificationRepo.create).toHaveBeenCalled();
      expect(emailService.sendEmailVerificationEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('http://test.com/auth/verify-email?token='),
        'user1',
      );
    });

    it('should silently return when user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await service.sendVerificationEmail('no@one.com');
      expect(emailVerificationRepo.create).not.toHaveBeenCalled();
    });

    it('should silently return when email already verified', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: true,
      });
      await service.sendVerificationEmail('a@b.com');
      expect(emailVerificationRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    const mockVerification = {
      id: 'v1',
      token: 'valid-token',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
      user: { id: 'u1', email: 'a@b.com', username: 'user1' },
    };

    it('should verify email with valid token', async () => {
      emailVerificationRepo.findByTokenWithUser.mockResolvedValue(mockVerification);

      await service.verifyEmail({ token: 'valid-token' });

      expect(emailVerificationRepo.verifyAndActivateUser).toHaveBeenCalledWith('v1', 'u1');
    });

    it('should emit USER_EMAIL_VERIFIED event', async () => {
      emailVerificationRepo.findByTokenWithUser.mockResolvedValue(mockVerification);

      await service.verifyEmail({ token: 'valid-token' });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.USER_EMAIL_VERIFIED,
        expect.objectContaining({ userId: 'u1', email: 'a@b.com' }),
      );
    });

    it('should throw for invalid token', async () => {
      emailVerificationRepo.findByTokenWithUser.mockResolvedValue(null);

      await expect(service.verifyEmail({ token: 'bad' })).rejects.toThrow(
        ERROR_MESSAGES.TOKEN_INVALID,
      );
    });

    it('should throw for already-used token', async () => {
      emailVerificationRepo.findByTokenWithUser.mockResolvedValue({
        ...mockVerification,
        usedAt: new Date(),
      });

      await expect(service.verifyEmail({ token: 'used' })).rejects.toThrow(
        ERROR_MESSAGES.TOKEN_ALREADY_USED,
      );
    });

    it('should throw for expired token', async () => {
      emailVerificationRepo.findByTokenWithUser.mockResolvedValue({
        ...mockVerification,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.verifyEmail({ token: 'expired' })).rejects.toThrow(
        ERROR_MESSAGES.TOKEN_EXPIRED,
      );
    });
  });
});
