import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { IMeta } from '@/common/interfaces';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { INotificationRepository, NOTIFICATION_REPOSITORY } from '@/database/repositories';
import {
  NotificationQueryDto,
  NotificationResponseDto,
  ReadAllResponseDto,
  UnreadCountResponseDto,
} from './dto';

export interface ICreateNotificationInput {
  type: string;
  title: string;
  body?: string | null;
  /** In-app path starting with a single "/"; anything else is dropped. */
  href?: string | null;
  data?: Record<string, unknown> | null;
}

const MAX_TYPE = 64;
const MAX_TITLE = 255;
const MAX_HREF = 512;
const MAX_BODY = 2000;
// Never resolved against; only used to parse and compare origins.
const BASE = 'http://internal.invalid';

const clamp = (text: string, max: number): string => text.slice(0, max);

/**
 * Returns a normalised same-origin in-app path, or null if `href` is anything
 * else (absolute URL, protocol-relative, backslashes, dot-segment tricks such
 * as "/.//evil.com" which the URL parser collapses to "//evil.com").
 */
export const sanitizeHref = (href: unknown): string | null => {
  if (typeof href !== 'string' || href.length === 0 || href.length > MAX_HREF) return null;
  // eslint-disable-next-line no-control-regex
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(href)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return null;
  const normalised = `${url.pathname}${url.search}${url.hash}`;
  return normalised.length <= MAX_HREF ? normalised : null;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notifications: INotificationRepository,
  ) {}

  /**
   * Best-effort: never throws, so a failed in-app notification cannot break
   * the business flow (or sibling listeners) that triggered it.
   * TODO: real-time delivery. Not emitted over websockets yet because the
   * events gateway lets any client join an arbitrary `user:<id>` room, which
   * would leak notifications; add it once room joins are authorised.
   */
  async create(userId: string, input: ICreateNotificationInput): Promise<Notification | null> {
    try {
      const href = input.href == null ? null : sanitizeHref(input.href);
      if (input.href != null && href === null) {
        this.logger.warn(`Dropping invalid href on "${input.type}" notification`);
      }
      return await this.notifications.create({
        userId,
        type: clamp(input.type, MAX_TYPE),
        title: clamp(input.title, MAX_TITLE),
        body: input.body == null ? null : clamp(input.body, MAX_BODY),
        href,
        data: (input.data ?? null) as Prisma.InputJsonValue | null,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create "${input.type}" notification for user ${userId}:`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  async list(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<{ data: NotificationResponseDto[]; meta: IMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const { items, total } = await this.notifications.findManyByUser(userId, {
      skip: (page - 1) * limit,
      take: limit,
      unreadOnly: query.unreadOnly === true,
    });
    return { data: items.map(toResponse), meta: createPaginationMeta(page, limit, total) };
  }

  async unreadCount(userId: string): Promise<UnreadCountResponseDto> {
    return { count: await this.notifications.countUnread(userId) };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const found = await this.notifications.markRead(id, userId);
    // Same error for "missing" and "someone else's" so existence isn't revealed.
    if (!found) throw new NotFoundException('Notification');
  }

  async markAllRead(userId: string): Promise<ReadAllResponseDto> {
    return { updated: await this.notifications.markAllRead(userId) };
  }
}

const toResponse = (n: Notification): NotificationResponseDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  href: n.href,
  data: (n.data as Record<string, unknown> | null) ?? null,
  read: n.readAt !== null,
  readAt: n.readAt ? n.readAt.toISOString() : null,
  createdAt: n.createdAt.toISOString(),
});
