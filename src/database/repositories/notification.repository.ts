import { Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  ICreateNotification,
  INotificationListOptions,
  INotificationRepository,
} from './interfaces';

@Injectable()
export class NotificationRepository implements INotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ICreateNotification): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        href: data.href ?? null,
        data: data.data ?? Prisma.DbNull,
      },
    });
  }

  async findManyByUser(
    userId: string,
    { skip, take, unreadOnly }: INotificationListOptions,
  ): Promise<{ items: Notification[]; total: number }> {
    const where: Prisma.NotificationWhereInput = { userId, ...(unreadOnly && { readAt: null }) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total };
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(id: string, userId: string): Promise<boolean> {
    // readAt: null in the filter keeps the first readAt on repeat calls.
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) return true;
    const exists = await this.prisma.notification.count({ where: { id, userId } });
    return exists > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}
