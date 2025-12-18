import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { UsersService } from '@/modules/users/users.service';
import { EmailQueue } from '@/jobs/queues';
import { BadRequestException } from '@/common/exceptions';
import { ERROR_MESSAGES } from '@/common/constants';
import { IAppConfig } from '@/config';
import { IRequestUser } from '@/common/interfaces';
import { VerifyEmailDto } from '../dto/verify-email.dto';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
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
    // Invalidate existing tokens
    await this.prisma.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token
    await this.prisma.emailVerification.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    // Build verification URL
    const verificationUrl = `${this.frontendUrl}/auth/verify-email?token=${token}`;

    // Queue email
    await this.emailQueue.addEmailVerificationEmail(email, verificationUrl, username);

    this.logger.log(`Verification email queued for: ${email}`);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const verification = await this.prisma.emailVerification.findUnique({
      where: { token: dto.token },
      include: { user: true },
    });

    if (!verification) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_INVALID);
    }

    if (verification.usedAt) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_ALREADY_USED);
    }

    if (new Date() > verification.expiresAt) {
      throw new BadRequestException(ERROR_MESSAGES.TOKEN_EXPIRED);
    }

    // Update user and mark token as used
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerified: true, status: UserStatus.ACTIVE },
      }),
      this.prisma.emailVerification.update({
        where: { id: verification.id },
        data: { usedAt: new Date() },
      }),
    ]);

    this.logger.log(`Email verified for user: ${verification.user.email}`);
  }
}
