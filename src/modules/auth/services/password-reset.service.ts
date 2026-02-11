import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthProvider } from '@prisma/client';
import { UsersService } from '@/modules/users/users.service';
import { EmailService } from '@/jobs/services';
import { BadRequestException } from '@/common/exceptions';
import { hashPassword } from '@/common/utils';
import { ERROR_MESSAGES } from '@/common/constants';
import { IAppConfig } from '@/config';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { IPasswordResetRepository, PASSWORD_RESET_REPOSITORY } from '@/database/repositories';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResetRepository: IPasswordResetRepository,
  ) {
    const appConfig = this.configService.get<IAppConfig>('app');
    this.frontendUrl = appConfig?.frontendUrl || 'http://localhost:4200';
  }

  async requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.usersService.findByEmail(dto.email);

    // Always return success to prevent email enumeration
    if (!user) {
      this.logger.warn(`Password reset requested for non-existent email: ${dto.email}`);
      return;
    }

    // Check if user is OAuth-only (no password)
    if (user.provider !== AuthProvider.LOCAL) {
      this.logger.warn(`Password reset requested for OAuth user: ${dto.email}`);
      return;
    }

    // Invalidate existing tokens for this user using repository
    await this.passwordResetRepository.invalidateUserTokens(user.id);

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token using repository
    await this.passwordResetRepository.create({
      token,
      expiresAt,
      user: { connect: { id: user.id } },
    });

    // Build reset URL
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;

    // Send email
    await this.emailService.sendPasswordResetEmail(user.email, resetUrl, user.username);

    this.logger.log(`Password reset email sent for: ${user.email}`);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Validate passwords match
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Find token with user relation using repository
    const passwordReset = await this.passwordResetRepository.findByTokenWithUser(dto.token);

    if (!passwordReset) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_INVALID);
    }

    // Check if already used
    if (passwordReset.usedAt) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_ALREADY_USED);
    }

    // Check expiry
    if (new Date() > passwordReset.expiresAt) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_EXPIRED);
    }

    // Hash new password and update user atomically using repository
    const hashedPassword = await hashPassword(dto.password);

    await this.passwordResetRepository.resetPasswordWithToken(
      passwordReset.id,
      passwordReset.userId,
      hashedPassword,
    );

    this.logger.log(`Password reset completed for user: ${passwordReset.user.email}`);
  }
}
