import { Injectable } from '@nestjs/common';
import { RefreshSession } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IRefreshSessionRepository } from './interfaces';

@Injectable()
export class RefreshSessionRepository implements IRefreshSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshSession> {
    return this.prisma.refreshSession.create({
      data: {
        user: { connect: { id: data.userId } },
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findActiveByTokenHash(tokenHash: string): Promise<RefreshSession | null> {
    return this.prisma.refreshSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async revokeByTokenHash(tokenHash: string, userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async rotate(
    id: string,
    expectedOldTokenHash: string,
    newTokenHash: string,
    newExpiresAt: Date,
  ): Promise<RefreshSession | null> {
    const { count } = await this.prisma.refreshSession.updateMany({
      where: { id, tokenHash: expectedOldTokenHash, revokedAt: null },
      data: { tokenHash: newTokenHash, expiresAt: newExpiresAt },
    });

    if (count === 0) {
      return null;
    }

    return this.prisma.refreshSession.findUniqueOrThrow({ where: { id } });
  }
}
