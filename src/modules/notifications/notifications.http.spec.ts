/**
 * HTTP-level test for /notifications: boots the real NotificationsModule behind
 * the production ValidationPipe options, with an in-memory repository that
 * mirrors the Prisma repository's scoping so ownership rules are exercised.
 * JwtAuthGuard is replaced by a stand-in that 401s when no user is attached.
 */
import {
  CanActivate,
  ExecutionContext,
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { GlobalExceptionFilter } from '@/common/filters';
import { ResponseInterceptor } from '@/common/interceptors';
import { NOTIFICATION_REPOSITORY } from '@/database/repositories';
import { NotificationsModule } from './notifications.module';

interface IRow {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}

let rows: IRow[] = [];

const repo = {
  create: jest.fn(),
  findManyByUser: jest.fn(
    async (
      userId: string,
      { skip, take, unreadOnly }: { skip: number; take: number; unreadOnly: boolean },
    ) => {
      const mine = rows
        .filter((r) => r.userId === userId && (!unreadOnly || r.readAt === null))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: mine.slice(skip, skip + take), total: mine.length };
    },
  ),
  countUnread: jest.fn(
    async (userId: string) => rows.filter((r) => r.userId === userId && !r.readAt).length,
  ),
  markRead: jest.fn(async (id: string, userId: string) => {
    const r = rows.find((x) => x.id === id && x.userId === userId);
    if (!r) return false;
    r.readAt ??= new Date();
    return true;
  }),
  markAllRead: jest.fn(async (userId: string) => {
    const unread = rows.filter((r) => r.userId === userId && !r.readAt);
    unread.forEach((r) => (r.readAt = new Date()));
    return unread.length;
  }),
};

class RequireUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (!req.user) throw new UnauthorizedException();
    return true;
  }
}

@Global()
@Module({
  providers: [{ provide: NOTIFICATION_REPOSITORY, useValue: repo }],
  exports: [NOTIFICATION_REPOSITORY],
})
class StubsModule {}

@Module({
  imports: [StubsModule, NotificationsModule],
  providers: [{ provide: APP_GUARD, useClass: RequireUserGuard }],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        const id = req.header('x-test-user');
        if (id) (req as Request & { user: unknown }).user = { id, role: 'CUSTOMER' };
        next();
      })
      .forRoutes('(.*)');
  }
}

const mk = (id: string, userId: string, minute: number, readAt: Date | null = null): IRow => ({
  id,
  userId,
  type: 'shopper.approved',
  title: `Title ${id}`,
  body: null,
  href: '/shopper',
  data: null,
  readAt,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
});

describe('/notifications (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    rows = [
      mk('11111111-1111-4111-8111-111111111111', 'alice', 1),
      mk('22222222-2222-4222-8222-222222222222', 'alice', 2, new Date('2026-02-01T00:00:00.000Z')),
      mk('33333333-3333-4333-8333-333333333333', 'alice', 3),
      mk('44444444-4444-4444-8444-444444444444', 'bob', 4),
      mk('55555555-5555-4555-8555-555555555555', 'bob', 5),
    ];
    jest.clearAllMocks();
  });

  const call = (method: string, path: string, user: string | null): Promise<Response> =>
    fetch(`${baseUrl}${path}`, { method, headers: user ? { 'x-test-user': user } : {} });

  it.each([
    ['GET', '/notifications'],
    ['GET', '/notifications/unread-count'],
    ['PATCH', '/notifications/read-all'],
    ['PATCH', '/notifications/11111111-1111-4111-8111-111111111111/read'],
  ])('rejects unauthenticated %s %s', async (method, path) => {
    const res = await call(method, path, null);
    expect(res.status).toBe(401);
    expect(repo.findManyByUser).not.toHaveBeenCalled();
    expect(repo.markRead).not.toHaveBeenCalled();
    expect(repo.markAllRead).not.toHaveBeenCalled();
  });

  it('lists only the caller own notifications, newest first, in the paginated envelope', async () => {
    const res = await call('GET', '/notifications', 'alice');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.map((n: { id: string }) => n.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(json.meta).toMatchObject({ page: 1, limit: 10, total: 3, totalPages: 1 });
    expect(json.data[1]).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'shopper.approved',
      title: 'Title 22222222-2222-4222-8222-222222222222',
      body: null,
      href: '/shopper',
      data: null,
      read: true,
      readAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:02:00.000Z',
    });
    expect(json.data[0]).toMatchObject({ read: false, readAt: null });
  });

  it('paginates', async () => {
    const json = await (await call('GET', '/notifications?page=2&limit=2', 'alice')).json();
    expect(json.data.map((n: { id: string }) => n.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(json.meta).toMatchObject({ page: 2, limit: 2, total: 3, hasNextPage: false });
  });

  it('unreadOnly=true returns only unread', async () => {
    const json = await (await call('GET', '/notifications?unreadOnly=true', 'alice')).json();
    expect(json.data.map((n: { id: string }) => n.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('unreadOnly=false is honoured (not coerced to true)', async () => {
    const json = await (await call('GET', '/notifications?unreadOnly=false', 'alice')).json();
    expect(json.data).toHaveLength(3);
    expect(repo.findManyByUser).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ unreadOnly: false }),
    );
  });

  it.each(['yes', '1', ''])('rejects unreadOnly=%p with 400', async (v) => {
    const res = await call('GET', `/notifications?unreadOnly=${v}`, 'alice');
    expect(res.status).toBe(400);
  });

  it.each(['limit=0', 'limit=-1', 'limit=101', 'limit=abc', 'page=0', 'page=x'])(
    'rejects %s with 400',
    async (qs) => {
      const res = await call('GET', `/notifications?${qs}`, 'alice');
      expect(res.status).toBe(400);
      expect(repo.findManyByUser).not.toHaveBeenCalled();
    },
  );

  it('accepts the maximum limit', async () => {
    const res = await call('GET', '/notifications?limit=100', 'alice');
    expect(res.status).toBe(200);
  });

  it('unread-count counts only the caller own unread', async () => {
    const json = await (await call('GET', '/notifications/unread-count', 'alice')).json();
    expect(json.data).toEqual({ count: 2 });
  });

  it('PATCH :id/read marks the caller own notification and keeps the first readAt', async () => {
    expect(
      (await call('PATCH', '/notifications/11111111-1111-4111-8111-111111111111/read', 'alice'))
        .status,
    ).toBe(200);
    const first = rows.find((r) => r.id === '11111111-1111-4111-8111-111111111111')?.readAt;
    expect(first).toBeInstanceOf(Date);
    expect(
      (await call('PATCH', '/notifications/11111111-1111-4111-8111-111111111111/read', 'alice'))
        .status,
    ).toBe(200);
    expect(rows.find((r) => r.id === '11111111-1111-4111-8111-111111111111')?.readAt).toBe(first);
  });

  it("PATCH :id/read on someone else's notification is 404 and changes nothing", async () => {
    const res = await call(
      'PATCH',
      '/notifications/44444444-4444-4444-8444-444444444444/read',
      'alice',
    );
    expect(res.status).toBe(404);
    expect(rows.find((r) => r.id === '44444444-4444-4444-8444-444444444444')?.readAt).toBeNull();
  });

  it('PATCH :id/read with a malformed id is a 400', async () => {
    expect((await call('PATCH', '/notifications/nope/read', 'alice')).status).toBe(400);
  });

  it('PATCH :id/read on a missing id is the same 404', async () => {
    const missing = await call(
      'PATCH',
      '/notifications/99999999-9999-4999-8999-999999999999/read',
      'alice',
    );
    const foreign = await call(
      'PATCH',
      '/notifications/44444444-4444-4444-8444-444444444444/read',
      'alice',
    );
    expect(missing.status).toBe(404);
    const strip = ({
      path: _p,
      timestamp: _t,
      ...rest
    }: Record<string, unknown>): Record<string, unknown> => rest;
    expect(strip(await missing.json())).toEqual(strip(await foreign.json()));
  });

  it('PATCH read-all only touches the caller own rows and is not captured as an id', async () => {
    const res = await call('PATCH', '/notifications/read-all', 'alice');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ updated: 2 });
    expect(rows.filter((r) => r.userId === 'alice').every((r) => r.readAt)).toBe(true);
    expect(rows.filter((r) => r.userId === 'bob').every((r) => r.readAt === null)).toBe(true);
    expect(repo.markRead).not.toHaveBeenCalled();
    const again = await (await call('PATCH', '/notifications/read-all', 'alice')).json();
    expect(again.data).toEqual({ updated: 0 });
  });
});
