/**
 * HTTP-level test of feature-flag gating on the shopping controllers.
 *
 * Boots the real ShoppingRequestsModule with the REAL FeatureFlagService (only its
 * repository is stubbed), the real RolesGuard and a stand-in for the JWT guard (401 with no
 * user), so what is exercised is the order the guards run in and what each gated route
 * answers: 401 before the flag is looked at, then 404 FEATURE_DISABLED when the flag is off
 * for the caller's role, and normal handling when it is on.
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
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '@common/guards/roles.guard';
import { GlobalExceptionFilter } from '@/common/filters';
import { ResponseInterceptor } from '@/common/interceptors';
import { AuditService } from '@common/services/audit.service';
import { FeatureFlagService } from '@modules/feature-flags/feature-flag.service';
import { FeatureFlagsModule } from '@modules/feature-flags/feature-flags.module';
import {
  FEATURE_FLAG_REPOSITORY,
  SHOPPER_ORDER_REPOSITORY,
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_CONFIG_REPOSITORY,
  SHOPPING_OFFER_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  SHOPPING_REQUEST_REPOSITORY,
} from '@/database/repositories';
import { ShoppingRequestsModule } from './shopping-requests.module';
import { RULES } from './testing/fixtures';

const ID = '3f2b8c1e-9d4a-4b7e-8a51-0c6d2e7f9a10';
const OFFER = '4a3c9d2f-0e5b-4c8f-9b62-1d7e3f8a0b21';

type Flag = { key: string; enabled: boolean; allowedRoles: UserRole[] };
const flagRows: Flag[] = [];
const flagRepo = { list: jest.fn(async () => flagRows.map((f) => ({ ...f }))) };
const empty = {
  findOwnedById: jest.fn(async () => null),
  listForCustomer: jest.fn(async () => ({ rows: [], total: 0 })),
  listForShopper: jest.fn(async () => ({ rows: [], total: 0 })),
  findMatchingForShopper: jest.fn(async () => ({ rows: [], total: 0 })),
  findOwnedByShopper: jest.fn(async () => null),
  findOwnedByCustomer: jest.fn(async () => null),
  cancel: jest.fn(async () => ({ outcome: 'not_found' })),
  acceptOffer: jest.fn(async () => ({ outcome: 'not_found' })),
  transition: jest.fn(async () => ({ outcome: 'not_found' })),
  expireStale: jest.fn(async () => []),
  expireElapsed: jest.fn(async () => 0),
  expireDue: jest.fn(async () => 0),
  findPendingRequestIds: jest.fn(async () => new Set()),
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
  providers: [
    { provide: FEATURE_FLAG_REPOSITORY, useValue: flagRepo },
    {
      provide: SHOPPER_PROFILE_REPOSITORY,
      useValue: {
        ensureByUserId: jest.fn(async () => ({
          id: 'prof-1',
          accountState: 'APPROVED',
          isOnline: true,
        })),
      },
    },
    { provide: SHOPPER_ORDER_REPOSITORY, useValue: empty },
    { provide: SHOPPING_REQUEST_REPOSITORY, useValue: empty },
    { provide: SHOPPING_OFFER_REPOSITORY, useValue: empty },
    { provide: SHOPPING_REFERENCE_REPOSITORY, useValue: {} },
    { provide: SHOPPING_CONFIG_REPOSITORY, useValue: { get: jest.fn(async () => RULES) } },
    { provide: AuditService, useValue: { log: jest.fn() } },
  ],
  exports: [
    FEATURE_FLAG_REPOSITORY,
    SHOPPER_PROFILE_REPOSITORY,
    SHOPPER_ORDER_REPOSITORY,
    SHOPPING_REQUEST_REPOSITORY,
    SHOPPING_OFFER_REPOSITORY,
    SHOPPING_REFERENCE_REPOSITORY,
    SHOPPING_CONFIG_REPOSITORY,
    AuditService,
  ],
})
class StubsModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    EventEmitterModule.forRoot(),
    StubsModule,
    FeatureFlagsModule,
    ShoppingRequestsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RequireUserGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        const role = req.header('x-test-role');
        if (role) {
          (req as Request & { user: unknown }).user = {
            id: 'user-1',
            email: 'u@example.com',
            role,
          };
        }
        next();
      })
      .forRoutes('(.*)');
  }
}

// [flag, role that owns the route, method, path, body]
const MARKETPLACE: Array<[string, string, string, unknown?]> = [
  ['PERSONAL_SHOPPER', 'GET', '/shopper/requests'],
  ['PERSONAL_SHOPPER', 'GET', `/shopper/requests/${ID}`],
  [
    'PERSONAL_SHOPPER',
    'POST',
    `/shopper/requests/${ID}/offers/preview`,
    { shopperFee: 1000, etaMinutes: 20 },
  ],
  [
    'PERSONAL_SHOPPER',
    'POST',
    `/shopper/requests/${ID}/offers`,
    { shopperFee: 1000, etaMinutes: 20 },
  ],
  ['PERSONAL_SHOPPER', 'GET', '/shopper/offers'],
  ['PERSONAL_SHOPPER', 'GET', `/shopper/offers/${ID}`],
  ['PERSONAL_SHOPPER', 'DELETE', `/shopper/offers/${ID}`],
  ['CUSTOMER', 'POST', '/shopping-requests', {}],
  ['CUSTOMER', 'GET', '/shopping-requests'],
  ['CUSTOMER', 'GET', `/shopping-requests/${ID}`],
  ['CUSTOMER', 'DELETE', `/shopping-requests/${ID}`],
];
const ORDERS: Array<[string, string, string, unknown?]> = [
  ['CUSTOMER', 'POST', `/shopping-requests/${ID}/offers/${OFFER}/accept`],
  ['CUSTOMER', 'GET', '/shopping-orders'],
  ['CUSTOMER', 'GET', `/shopping-orders/${ID}`],
  ['CUSTOMER', 'GET', `/shopping-orders/${ID}/events`],
  ['CUSTOMER', 'POST', `/shopping-orders/${ID}/cancel`, {}],
  ['PERSONAL_SHOPPER', 'GET', '/shopper/orders'],
  ['PERSONAL_SHOPPER', 'GET', `/shopper/orders/${ID}`],
  ['PERSONAL_SHOPPER', 'GET', `/shopper/orders/${ID}/events`],
  ['PERSONAL_SHOPPER', 'POST', `/shopper/orders/${ID}/accept`],
  ['PERSONAL_SHOPPER', 'POST', `/shopper/orders/${ID}/start`],
];

describe('feature-flag gating: shopping controllers (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  const setFlags = (
    flags: Partial<Record<string, { enabled?: boolean; allowedRoles?: UserRole[] }>>,
  ): void => {
    flagRows.length = 0;
    for (const key of ['shopper_marketplace', 'shopper_orders', 'handyman_application_flows']) {
      flagRows.push({ key, enabled: true, allowedRoles: [], ...flags[key] });
    }
    app.get(FeatureFlagService).invalidate();
  };
  const call = async (
    role: string | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const disabled = (r: { status: number; json: any }): boolean =>
    r.status === 404 && r.json?.code === 'FEATURE_DISABLED';

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
  beforeEach(() => setFlags({}));

  describe.each([
    ['shopper_marketplace', MARKETPLACE],
    ['shopper_orders', ORDERS],
  ])('flag %s', (flag, rawRoutes) => {
    // jest-each hands `done` to a callback with more parameters than the row has: pad every row to 4.
    const routes = rawRoutes.map((r) => [r[0], r[1], r[2], r[3] ?? null] as const);
    it.each(routes)(
      '%s %s %s: 401 with no user, even when the flag is off',
      async (_role, method, path, body) => {
        setFlags({ [flag]: { enabled: false } });
        expect((await call(null, method, path, body)).status).toBe(401);
      },
    );

    it.each(routes)(
      '%s %s %s: 404 FEATURE_DISABLED, "not available yet", when the flag is off',
      async (role, method, path, body) => {
        setFlags({ [flag]: { enabled: false } });
        const result = await call(role, method, path, body);
        expect(result.status).toBe(404);
        expect(result.json).toMatchObject({
          success: false,
          message: 'This feature is not available yet',
          code: 'FEATURE_DISABLED',
        });
      },
    );

    it.each(routes)(
      '%s %s %s: handled normally when the flag is on',
      async (role, method, path, body) => {
        const result = await call(role, method, path, body);
        expect(disabled(result)).toBe(false);
        expect(result.status).not.toBe(401);
      },
    );

    it('turning the flag off in the table, then on again, is seen on the very next call after invalidation', async () => {
      const [role, method, path, body] = routes[0];
      expect(disabled(await call(role, method, path, body))).toBe(false);
      setFlags({ [flag]: { enabled: false } });
      expect(disabled(await call(role, method, path, body))).toBe(true);
      setFlags({});
      expect(disabled(await call(role, method, path, body))).toBe(false);
    });
  });

  describe('a role-restricted flag', () => {
    it('lets only the listed roles through; the others get 404 FEATURE_DISABLED', async () => {
      setFlags({ shopper_marketplace: { allowedRoles: [UserRole.PERSONAL_SHOPPER] } });
      expect(disabled(await call('PERSONAL_SHOPPER', 'GET', '/shopper/requests'))).toBe(false);
      expect(disabled(await call('CUSTOMER', 'GET', '/shopping-requests'))).toBe(true);
      // the other flags are unaffected
      expect(disabled(await call('CUSTOMER', 'GET', '/shopping-orders'))).toBe(false);
    });
  });

  describe('which routes each flag gates', () => {
    it('the accept route follows shopper_orders, NOT shopper_marketplace', async () => {
      const accept = `/shopping-requests/${ID}/offers/${OFFER}/accept`;
      setFlags({ shopper_marketplace: { enabled: false } });
      expect(disabled(await call('CUSTOMER', 'POST', accept))).toBe(false);
      expect(disabled(await call('CUSTOMER', 'GET', '/shopping-requests'))).toBe(true);

      setFlags({ shopper_orders: { enabled: false } });
      expect(disabled(await call('CUSTOMER', 'POST', accept))).toBe(true);
      expect(disabled(await call('CUSTOMER', 'GET', '/shopping-requests'))).toBe(false);
    });

    it('ADMIN is let past the flag, and is then stopped by the role guard like on any customer route', async () => {
      setFlags({ shopper_marketplace: { enabled: false }, shopper_orders: { enabled: false } });
      for (const path of ['/shopping-requests', '/shopper/requests', '/shopping-orders']) {
        const result = await call('ADMIN', 'GET', path);
        expect(disabled(result)).toBe(false); // the role guard (403) answers, not the flag
        expect(result.status).toBe(403);
      }
    });
  });

  describe('GET /feature-flags', () => {
    it('is 401 with no user, and gives each caller only booleans evaluated for their role', async () => {
      expect((await call(null, 'GET', '/feature-flags')).status).toBe(401);
      setFlags({
        shopper_orders: { enabled: false },
        handyman_application_flows: { allowedRoles: [UserRole.HANDYMAN] },
      });
      const customer = await call('CUSTOMER', 'GET', '/feature-flags');
      expect(customer.status).toBe(200);
      expect(customer.json.data).toEqual({
        flags: {
          shopper_marketplace: true,
          shopper_orders: false,
          handyman_application_flows: false,
        },
      });
      expect((await call('HANDYMAN', 'GET', '/feature-flags')).json.data.flags).toEqual({
        shopper_marketplace: true,
        shopper_orders: false,
        handyman_application_flows: true,
      });
      expect((await call('ADMIN', 'GET', '/feature-flags')).json.data.flags).toEqual({
        shopper_marketplace: true,
        shopper_orders: true,
        handyman_application_flows: true,
      });
    });
  });
});
