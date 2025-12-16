import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthProvider } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { UsersService } from '@/modules/users/users.service';
import { EmailQueue } from '@/jobs/queues';
import { BadRequestException } from '@/common/exceptions';
import { hashPassword } from '@/common/utils';
import { ERROR_MESSAGES } from '@/common/constants';
import { IAppConfig } from '@/config';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly emailQueue: EmailQueue,
    private readonly configService: ConfigService,
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

    // Invalidate existing tokens for this user
    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token
    await this.prisma.passwordReset.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    // Build reset URL
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;

    // Queue email
    await this.emailQueue.addPasswordResetEmail(user.email, resetUrl, user.username);

    this.logger.log(`Password reset email queued for: ${user.email}`);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Validate passwords match
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Find token
    const passwordReset = await this.prisma.passwordReset.findUnique({
      where: { token: dto.token },
      include: { user: true },
    });

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

    // Hash new password and update user
    const hashedPassword = await hashPassword(dto.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: passwordReset.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordReset.update({
        where: { id: passwordReset.id },
        data: { usedAt: new Date() },
      }),
    ]);

    this.logger.log(`Password reset completed for user: ${passwordReset.user.email}`);
  }
}
