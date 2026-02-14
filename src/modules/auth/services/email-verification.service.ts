import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { UsersService } from '@/modules/users/users.service';
import { EmailService } from '@/jobs/services';
import { BadRequestException } from '@/common/exceptions';
import { ERROR_MESSAGES, EVENTS } from '@/common/constants';
import { IAppConfig } from '@/config';
import { IRequestUser } from '@/common/interfaces';
import { UserVerifiedEvent } from '@/common/events';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import {
  IEmailVerificationRepository,
  EMAIL_VERIFICATION_REPOSITORY,
} from '@/database/repositories';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(EMAIL_VERIFICATION_REPOSITORY)
    private readonly emailVerificationRepository: IEmailVerificationRepository,
  ) {
    const appConfig = this.configService.get<IAppConfig>('app');
    this.frontendUrl = appConfig?.frontendUrl || 'http://localhost:4200';
  }

  async sendVerificationEmail(user: IRequestUser): Promise<void> {
    const fullUser = await this.usersService.findById(user.id);

    if (!fullUser) {
      throw new BadRequestException('User not found');
    }

    if (fullUser.emailVerified) {
      throw new BadRequestException(ERROR_MESSAGES.EMAIL_ALREADY_VERIFIED);
    }

    await this.sendVerificationEmailByUserId(fullUser.id, fullUser.email, fullUser.username);
  }

  async sendVerificationEmailByUserId(
    userId: string,
    email: string,
    username: string,
  ): Promise<void> {
    // Invalidate existing tokens using repository
    await this.emailVerificationRepository.invalidateUserTokens(userId);

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token using repository
    await this.emailVerificationRepository.create({
      token,
      expiresAt,
      user: { connect: { id: userId } },
    });

    // Build verification URL
    const verificationUrl = `${this.frontendUrl}/auth/verify-email?token=${token}`;

    // Send email
    await this.emailService.sendEmailVerificationEmail(email, verificationUrl, username);

    this.logger.log(`Verification email sent for: ${email}`);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    // Find token with user relation using repository
    const verification = await this.emailVerificationRepository.findByTokenWithUser(dto.token);

    if (!verification) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_INVALID);
    }

    if (verification.usedAt) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_ALREADY_USED);
    }

    if (new Date() > verification.expiresAt) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_EXPIRED);
    }

    // Update user and mark token as used atomically using repository
    await this.emailVerificationRepository.verifyAndActivateUser(
      verification.id,
      verification.userId,
    );

    this.logger.log(`Email verified for user: ${verification.user.email}`);

    // Emit event for other services to react (e.g., send welcome email)
    const event = new UserVerifiedEvent(
      verification.user.id,
      verification.user.email,
      verification.user.username,
    );
    this.eventEmitter.emit(EVENTS.USER_EMAIL_VERIFIED, event);
  }
}
