import { Injectable } from '@nestjs/common';
import { PasswordReset, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IPasswordResetRepository, PasswordResetWithUser } from './interfaces';

@Injectable()
export class PasswordResetRepository implements IPasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.PasswordResetCreateInput): Promise<PasswordReset> {
    return this.prisma.passwordReset.create({ data });
  }

  async findById(id: string): Promise<PasswordReset | null> {
    return this.prisma.passwordReset.findUnique({
      where: { id },
    });
  }

  async findByToken(token: string): Promise<PasswordReset | null> {
    return this.prisma.passwordReset.findUnique({
      where: { token },
    });
  }

  async findByTokenWithUser(token: string): Promise<PasswordResetWithUser | null> {
    return this.prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  async findValidByToken(token: string): Promise<PasswordReset | null> {
    return this.prisma.passwordReset.findFirst({
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
  }): Promise<PasswordReset[]> {
    return this.prisma.passwordReset.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Partial<PasswordReset>): Promise<number> {
    return this.prisma.passwordReset.count({
      where,
    });
  }

  async update(id: string, data: Prisma.PasswordResetUpdateInput): Promise<PasswordReset> {
    return this.prisma.passwordReset.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.passwordReset.delete({ where: { id } });
  }

  async markAsUsed(id: string): Promise<void> {
    await this.prisma.passwordReset.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async invalidateUserTokens(userId: string): Promise<void> {
    await this.prisma.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  async resetPasswordWithToken(
    tokenId: string,
    userId: string,
    hashedPassword: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordReset.update({
        where: { id: tokenId },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.passwordReset.deleteMany({
      where: { userId },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.passwordReset.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }
}
