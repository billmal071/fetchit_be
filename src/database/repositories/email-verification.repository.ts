import { Injectable } from '@nestjs/common';
import { EmailVerification, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IEmailVerificationRepository, EmailVerificationWithUser } from './interfaces';

@Injectable()
export class EmailVerificationRepository implements IEmailVerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.EmailVerificationCreateInput): Promise<EmailVerification> {
    return this.prisma.emailVerification.create({ data });
  }

  async findById(id: string): Promise<EmailVerification | null> {
    return this.prisma.emailVerification.findUnique({
      where: { id },
    });
  }

  async findByToken(token: string): Promise<EmailVerification | null> {
    return this.prisma.emailVerification.findUnique({
      where: { token },
    });
  }

  async findByTokenWithUser(token: string): Promise<EmailVerificationWithUser | null> {
    return this.prisma.emailVerification.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  async findValidByToken(token: string): Promise<EmailVerification | null> {
    return this.prisma.emailVerification.findFirst({
      where: {
        token,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<EmailVerification[]> {
    return this.prisma.emailVerification.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Partial<EmailVerification>): Promise<number> {
    return this.prisma.emailVerification.count({
      where,
    });
  }

  async update(id: string, data: Prisma.EmailVerificationUpdateInput): Promise<EmailVerification> {
    return this.prisma.emailVerification.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.emailVerification.delete({ where: { id } });
  }

  async markAsUsed(id: string): Promise<void> {
    await this.prisma.emailVerification.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async invalidateUserTokens(userId: string): Promise<void> {
    await this.prisma.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  async verifyAndActivateUser(tokenId: string, userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true, status: UserStatus.ACTIVE },
      }),
      this.prisma.emailVerification.update({
        where: { id: tokenId },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.emailVerification.deleteMany({
      where: { userId },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.emailVerification.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }
}
