import { Injectable } from '@nestjs/common';
import { Prisma, PushSubscription } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IPushSubscriptionRepository, IUpsertPushSubscription } from './interfaces';

@Injectable()
export class PushSubscriptionRepository implements IPushSubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByEndpoint(data: IUpsertPushSubscription): Promise<PushSubscription> {
    const fields = {
      userId: data.userId,
      p256dh: data.p256dh,
      auth: data.auth,
      userAgent: data.userAgent ?? null,
    };
    const run = (): Promise<PushSubscription> =>
      this.prisma.pushSubscription.upsert({
        where: { endpoint: data.endpoint },
        // Scalar userId (no nested connect) lets Prisma emit a native
        // INSERT ... ON CONFLICT instead of a racy select-then-insert.
        create: { endpoint: data.endpoint, ...fields },
        // Reassigns the row if the endpoint was registered by another user.
        update: fields,
      });
    try {
      return await run();
    } catch (error) {
      // Defensive: if Prisma falls back to select-then-insert and loses a race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return run();
      }
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<PushSubscription[]> {
    return this.prisma.pushSubscription.findMany({ where: { userId } });
  }

  async deleteByEndpointForUser(endpoint: string, userId: string): Promise<number> {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { endpoint, userId },
    });
    return count;
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { id } });
  }

  async markUsed(id: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
