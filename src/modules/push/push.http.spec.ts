/**
 * HTTP-level test for /push: boots the real PushModule behind the production
 * ValidationPipe options, with an in-memory repository so ownership rules
 * (reassign on upsert, delete scoped to caller) are exercised for real.
 * JwtAuthGuard is replaced by a stand-in that 401s when no user is attached.
 */
import { createECDH, randomBytes } from 'crypto';
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
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { GlobalExceptionFilter } from '@/common/filters';
import { ResponseInterceptor } from '@/common/interceptors';
import { PUSH_SUBSCRIPTION_REPOSITORY } from '@/database/repositories';
import { PushModule } from './push.module';

interface IRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

const rows = new Map<string, IRow>();
let seq = 0;

const repo = {
  upsertByEndpoint: jest.fn(async (d: Omit<IRow, 'id'>) => {
    const existing = rows.get(d.endpoint);
    const row = { ...d, userAgent: d.userAgent ?? null, id: existing?.id ?? `id-${++seq}` };
    rows.set(d.endpoint, row);
    return row;
  }),
  findByUserId: jest.fn(async (userId: string) =>
    [...rows.values()].filter((r) => r.userId === userId),
  ),
  deleteByEndpointForUser: jest.fn(async (endpoint: string, userId: string) => {
    const row = rows.get(endpoint);
    if (row && row.userId === userId) {
      rows.delete(endpoint);
      return 1;
    }
    return 0;
  }),
  deleteById: jest.fn(),
  markUsed: jest.fn(),
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
  providers: [{ provide: PUSH_SUBSCRIPTION_REPOSITORY, useValue: repo }],
  exports: [PUSH_SUBSCRIPTION_REPOSITORY],
})
class StubsModule {}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [
        (): Record<string, unknown> => ({
          push: { vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '' },
        }),
      ],
    }),
    StubsModule,
    PushModule,
  ],
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

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const P256DH = ecdh.getPublicKey().toString('base64url'); // 65 bytes, 87 chars
const AUTH = randomBytes(16).toString('base64url');

const VALID = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: P256DH, auth: AUTH },
  userAgent: 'jest',
};

describe('/push (HTTP)', () => {
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
    rows.clear();
    jest.clearAllMocks();
  });

  const call = (
    method: string,
    path: string,
    user: string | null,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { 'x-test-user': user } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('GET /push/config reports disabled when VAPID is not configured', async () => {
    const res = await call('GET', '/push/config', 'u1');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ enabled: false, publicKey: null });
  });

  it.each([
    ['GET', '/push/config', undefined],
    ['POST', '/push/subscriptions', VALID],
    ['DELETE', '/push/subscriptions', { endpoint: VALID.endpoint }],
  ])('rejects unauthenticated %s %s', async (method, path, body) => {
    const res = await call(method, path, null, body);
    expect(res.status).toBe(401);
    expect(repo.upsertByEndpoint).not.toHaveBeenCalled();
  });

  it('POST registers a subscription with 201', async () => {
    const res = await call('POST', '/push/subscriptions', 'u1', VALID);
    expect(res.status).toBe(201);
    expect(rows.get(VALID.endpoint)).toMatchObject({
      userId: 'u1',
      p256dh: P256DH,
      auth: AUTH,
      userAgent: 'jest',
    });
  });

  it.each([
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://web.push.apple.com/QabC',
  ])('POST accepts legit endpoint %s', async (endpoint) => {
    const res = await call('POST', '/push/subscriptions', 'u1', { ...VALID, endpoint });
    expect(res.status).toBe(201);
  });

  it('POST is an upsert and reassigns an endpoint held by another user', async () => {
    await call('POST', '/push/subscriptions', 'u1', VALID);
    const res = await call('POST', '/push/subscriptions', 'u2', VALID);
    expect(res.status).toBe(201);
    expect(rows.size).toBe(1);
    expect(rows.get(VALID.endpoint)?.userId).toBe('u2');
  });

  it.each([
    ['non-https endpoint', { ...VALID, endpoint: 'http://push.example.com/x' }],
    ['non-url endpoint', { ...VALID, endpoint: 'not a url' }],
    ['endpoint over 2048 chars', { ...VALID, endpoint: `https://e.com/${'a'.repeat(2048)}` }],
    ['missing endpoint', { keys: VALID.keys }],
    ['missing keys', { endpoint: VALID.endpoint }],
    ['missing auth key', { ...VALID, keys: { p256dh: P256DH } }],
    ['missing p256dh key', { ...VALID, keys: { auth: AUTH } }],
    ['empty key', { ...VALID, keys: { p256dh: '', auth: AUTH } }],
    ['p256dh too short', { ...VALID, keys: { p256dh: 'BPubKey', auth: AUTH } }],
    [
      'p256dh 64 bytes',
      { ...VALID, keys: { p256dh: randomBytes(64).toString('base64url'), auth: AUTH } },
    ],
    [
      'p256dh 66 bytes',
      { ...VALID, keys: { p256dh: randomBytes(66).toString('base64url'), auth: AUTH } },
    ],
    [
      'p256dh standard base64 (+/ and padding)',
      { ...VALID, keys: { p256dh: `${P256DH}=`, auth: AUTH } },
    ],
    ['p256dh with plus', { ...VALID, keys: { p256dh: `${P256DH.slice(1)}+`, auth: AUTH } }],
    [
      'auth under 16 bytes',
      { ...VALID, keys: { p256dh: P256DH, auth: randomBytes(15).toString('base64url') } },
    ],
    [
      'auth not base64url',
      { ...VALID, keys: { p256dh: P256DH, auth: 'authSecret!!!!!!!!!!!!!!' } },
    ],
    ['loopback endpoint', { ...VALID, endpoint: 'https://127.0.0.1/' }],
    ['metadata endpoint', { ...VALID, endpoint: 'https://169.254.169.254/' }],
    ['ipv6 endpoint', { ...VALID, endpoint: 'https://[::1]/' }],
    ['internal host', { ...VALID, endpoint: 'https://metadata.google.internal/' }],
    ['non-443 port', { ...VALID, endpoint: 'https://fcm.googleapis.com:22/x' }],
    ['userinfo endpoint', { ...VALID, endpoint: 'https://a.b@evil.com/' }],
    ['backslash trick', { ...VALID, endpoint: 'https://evil.com\\@fcm.googleapis.com/x' }],
    ['unlisted public host', { ...VALID, endpoint: 'https://push.example.com/x' }],
    ['userAgent over 512 chars', { ...VALID, userAgent: 'u'.repeat(513) }],
    ['unknown property', { ...VALID, userId: 'someone-else' }],
    ['unknown nested property', { ...VALID, keys: { ...VALID.keys, extra: 'x' } }],
  ])('POST rejects %s with 400', async (_name, body) => {
    const res = await call('POST', '/push/subscriptions', 'u1', body);
    expect(res.status).toBe(400);
    expect(repo.upsertByEndpoint).not.toHaveBeenCalled();
  });

  it('DELETE removes the caller own subscription', async () => {
    await call('POST', '/push/subscriptions', 'u1', VALID);
    const res = await call('DELETE', '/push/subscriptions', 'u1', { endpoint: VALID.endpoint });
    expect(res.status).toBe(200);
    expect(rows.size).toBe(0);
  });

  it('DELETE is idempotent when the subscription does not exist', async () => {
    const res = await call('DELETE', '/push/subscriptions', 'u1', { endpoint: VALID.endpoint });
    expect(res.status).toBe(200);
  });

  it("DELETE cannot remove another user's subscription (still 200, row kept)", async () => {
    await call('POST', '/push/subscriptions', 'u1', VALID);
    const res = await call('DELETE', '/push/subscriptions', 'u2', { endpoint: VALID.endpoint });
    expect(res.status).toBe(200);
    expect(rows.get(VALID.endpoint)?.userId).toBe('u1');
  });

  it('DELETE rejects a missing endpoint with 400', async () => {
    const res = await call('DELETE', '/push/subscriptions', 'u1', {});
    expect(res.status).toBe(400);
  });
});
