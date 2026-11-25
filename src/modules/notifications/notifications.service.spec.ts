import { NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { NotificationsService, sanitizeHref } from './notifications.service';

const row = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  userId: 'u1',
  type: 't',
  title: 'T',
  body: null,
  href: null,
  data: null,
  readAt: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  ...over,
});

describe('sanitizeHref', () => {
  it.each([
    ['/shopper', '/shopper'],
    ['/shopper/onboarding?x=1#a', '/shopper/onboarding?x=1#a'],
    ['/a/../b', '/b'],
  ])('keeps %s', (input, out) => expect(sanitizeHref(input)).toBe(out));

  it.each([
    'https://evil.com',
    '//evil.com',
    '/.//evil.com',
    '/a/..//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    'shopper',
    'javascript:alert(1)',
    '',
    `/${'a'.repeat(600)}`,
    42,
    null,
    undefined,
  ])('rejects %p', (input) => expect(sanitizeHref(input)).toBeNull());
});

describe('NotificationsService', () => {
  let repo: {
    create: jest.Mock;
    findManyByUser: jest.Mock;
    countUnread: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };
  let service: NotificationsService;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockResolvedValue(row()),
      findManyByUser: jest.fn(),
      countUnread: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };
    service = new NotificationsService(repo);
  });

  describe('create', () => {
    it('persists a valid notification', async () => {
      await service.create('u1', {
        type: 'x',
        title: 'Hi',
        body: 'b',
        href: '/shopper',
        data: { a: 1 },
      });
      expect(repo.create).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'x',
        title: 'Hi',
        body: 'b',
        href: '/shopper',
        data: { a: 1 },
      });
    });

    it('nulls an unsafe href but still creates the notification', async () => {
      await service.create('u1', { type: 'x', title: 'Hi', href: '/.//evil.com' });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ href: null }));
    });

    it('defaults optional fields to null and clamps over-long strings', async () => {
      await service.create('u1', { type: 'x'.repeat(100), title: 't'.repeat(300) });
      const arg = repo.create.mock.calls[0][0];
      expect(arg.type).toHaveLength(64);
      expect(arg.title).toHaveLength(255);
      expect(arg).toMatchObject({ body: null, href: null, data: null });
    });

    it('never throws when persistence fails', async () => {
      repo.create.mockRejectedValue(new Error('db down'));
      await expect(service.create('u1', { type: 'x', title: 'Hi' })).resolves.toBeNull();
    });
  });

  describe('list', () => {
    it('maps rows, scopes to the caller and builds meta', async () => {
      repo.findManyByUser.mockResolvedValue({
        items: [row({ readAt: new Date('2026-01-03T00:00:00.000Z'), data: { k: 1 } })],
        total: 25,
      });
      const res = await service.list('u1', { page: 2, limit: 10, unreadOnly: false } as never);
      expect(repo.findManyByUser).toHaveBeenCalledWith('u1', {
        skip: 10,
        take: 10,
        unreadOnly: false,
      });
      expect(res.data[0]).toEqual({
        id: 'n1',
        type: 't',
        title: 'T',
        body: null,
        href: null,
        data: { k: 1 },
        read: true,
        readAt: '2026-01-03T00:00:00.000Z',
        createdAt: '2026-01-02T03:04:05.000Z',
      });
      expect(res.meta).toMatchObject({ page: 2, limit: 10, total: 25, totalPages: 3 });
    });

    it('passes unreadOnly through and reports unread items as read:false', async () => {
      repo.findManyByUser.mockResolvedValue({ items: [row()], total: 1 });
      const res = await service.list('u1', { page: 1, limit: 10, unreadOnly: true } as never);
      expect(repo.findManyByUser).toHaveBeenCalledWith('u1', {
        skip: 0,
        take: 10,
        unreadOnly: true,
      });
      expect(res.data[0]).toMatchObject({ read: false, readAt: null });
    });
  });

  it('unreadCount wraps the repository count', async () => {
    repo.countUnread.mockResolvedValue(4);
    await expect(service.unreadCount('u1')).resolves.toEqual({ count: 4 });
    expect(repo.countUnread).toHaveBeenCalledWith('u1');
  });

  it('markRead scopes by user and 404s when not found', async () => {
    repo.markRead.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(service.markRead('u1', 'n1')).resolves.toBeUndefined();
    expect(repo.markRead).toHaveBeenCalledWith('n1', 'u1');
    await expect(service.markRead('u1', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markAllRead returns the updated count', async () => {
    repo.markAllRead.mockResolvedValue(3);
    await expect(service.markAllRead('u1')).resolves.toEqual({ updated: 3 });
    expect(repo.markAllRead).toHaveBeenCalledWith('u1');
  });
});
