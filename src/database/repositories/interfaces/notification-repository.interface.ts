import { Notification, Prisma } from '@prisma/client';

export interface ICreateNotification {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  data?: Prisma.InputJsonValue | null;
}

export interface INotificationListOptions {
  skip: number;
  take: number;
  unreadOnly: boolean;
}

/**
 * Notification Repository Interface
 *
 * Every read/write that takes a notification id is scoped by `userId` so one
 * user can never see or change another's rows.
 */
export interface INotificationRepository {
  create(data: ICreateNotification): Promise<Notification>;

  /** Newest first (createdAt desc, id desc as a stable tiebreak). */
  findManyByUser(
    userId: string,
    options: INotificationListOptions,
  ): Promise<{ items: Notification[]; total: number }>;

  countUnread(userId: string): Promise<number>;

  /**
   * Mark the caller's notification read, keeping the first `readAt` if it was
   * already read. Returns false when no such notification exists for this user.
   */
  markRead(id: string, userId: string): Promise<boolean>;

  /** Mark all the caller's unread notifications read; returns how many changed. */
  markAllRead(userId: string): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
