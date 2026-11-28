/**
 * HTTP-level test for GET and PATCH /admin/shopping-config.
 *
 * Boots the real controller and service behind the production ValidationPipe
 * options and the real RolesGuard, with the repository and audit log stubbed:
 * who may reach the routes, and the strict body validation, are what is at risk.
 */
import {
  CanActivate,
  ExecutionContext,
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
import { RolesGuard } from '@/common/guards';
import { SHOPPING_CONFIG_REPOSITORY, ShoppingConfigConstraintError } from '@/database/repositories';
import { AuditService } from '@common/services/audit.service';
import { AdminShoppingConfigController } from './admin-shopping-config.controller';
import { AdminShoppingConfigService } from './admin-shopping-config.service';

const RECORD = {
  minShopperFee: 500,
  maxShopperFee: 5000,
  deliveryFee: 1500,
  serviceChargePercent: 5,
  vatPercent: 7.5,
  priceBufferPercent: 10,
  offerWindowMinutes: 30,
  shopperAcceptWindowMinutes: 30,
  offerAcceptanceWindowMinutes: 1440,
  updatedAt: new Date('2026-11-26T10:00:00.000Z'),
  updatedBy: { id: 'admin-1', username: 'ada' },
};
const repo = { getRecord: jest.fn(), update: jest.fn() };
const audit = { log: jest.fn() };

class RequireUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (!req.user) throw new UnauthorizedException();
    return true;
  }
}

@Module({
  controllers: [AdminShoppingConfigController],
  providers: [
    AdminShoppingConfigService,
    { provide: SHOPPING_CONFIG_REPOSITORY, useValue: repo },
    { provide: AuditService, useValue: audit },
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
            id: 'admin-1',
            email: 'a@example.com',
            role,
          };
        }
        next();
      })
      .forRoutes('(.*)');
  }
}

describe('/admin/shopping-config (HTTP)', () => {
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
    jest.resetAllMocks();
    repo.getRecord.mockResolvedValue(RECORD);
  });

  const call = async (
    method: string,
    role: string | null,
    body?: unknown,
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/admin/shopping-config`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  describe('who may call it', () => {
    it.each(['GET', 'PATCH'])('%s is 401 without a user', async (method) => {
      expect(
        (await call(method, null, method === 'PATCH' ? { deliveryFee: 1 } : undefined)).status,
      ).toBe(401);
    });

    it.each(['CUSTOMER', 'PERSONAL_SHOPPER', 'HANDYMAN'])(
      '%s gets 403 on GET and PATCH',
      async (role) => {
        expect((await call('GET', role)).status).toBe(403);
        expect((await call('PATCH', role, { deliveryFee: 1 })).status).toBe(403);
        expect(repo.getRecord).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET', () => {
    it('returns the configuration in the success envelope', async () => {
      const { status, json } = await call('GET', 'ADMIN');
      expect(status).toBe(200);
      expect(json).toMatchObject({ success: true });
      expect(json.data).toEqual({
        minShopperFee: 500,
        maxShopperFee: 5000,
        deliveryFee: 1500,
        serviceChargePercent: 5,
        vatPercent: 7.5,
        priceBufferPercent: 10,
        offerWindowMinutes: 30,
        shopperAcceptWindowMinutes: 30,
        offerAcceptanceWindowMinutes: 1440,
        updatedAt: '2026-11-26T10:00:00.000Z',
        updatedBy: { id: 'admin-1', username: 'ada' },
      });
    });
  });

  describe('PATCH', () => {
    const ok = {
      outcome: 'updated',
      before: { deliveryFee: 1500 },
      after: { deliveryFee: 2000 },
      record: { ...RECORD, deliveryFee: 2000 },
    };

    it('applies a partial edit and returns the new configuration', async () => {
      repo.update.mockResolvedValue(ok);
      const { status, json } = await call('PATCH', 'ADMIN', { deliveryFee: 2000 });
      expect(status).toBe(200);
      expect(json.data.deliveryFee).toBe(2000);
      expect(repo.update.mock.calls[0][0]).toEqual({ deliveryFee: 2000 });
      expect(repo.update.mock.calls[0][1]).toBe('admin-1');
    });

    it('accepts decimal percentages up to two places', async () => {
      repo.update.mockResolvedValue(ok);
      expect(
        (
          await call('PATCH', 'ADMIN', {
            vatPercent: 7.5,
            serviceChargePercent: 0,
            priceBufferPercent: 12.25,
          })
        ).status,
      ).toBe(200);
    });

    it.each([
      ['an empty body', {}],
      ['an unknown field', { deliveryFee: 1, currency: 'USD' }],
      ['an id', { id: 2 }],
      ['updatedBy', { updatedBy: 'x' }],
      ['a fee sent as a string', { deliveryFee: '4500' }],
      ['a fee sent as a boolean', { deliveryFee: true }],
      ['a fractional fee', { deliveryFee: 10.5 }],
      ['a negative fee', { minShopperFee: -1 }],
      ['a fee over the cap', { deliveryFee: 1_000_000_001 }],
      ['a percentage as a string', { vatPercent: '7.5' }],
      ['a percentage over 100', { vatPercent: 100.01 }],
      ['a negative percentage', { serviceChargePercent: -1 }],
      ['a percentage with three decimals', { vatPercent: 7.555 }],
      ['a window of zero', { offerWindowMinutes: 0 }],
      ['a window as a string', { shopperAcceptWindowMinutes: '30' }],
      ['a fractional window', { offerAcceptanceWindowMinutes: 1.5 }],
      ['a window over 30 days', { offerWindowMinutes: 43_201 }],
      ['null', { deliveryFee: null }],
    ])('400s for %s, writing nothing', async (_label, body) => {
      expect((await call('PATCH', 'ADMIN', body)).status).toBe(400);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('422s with the reason when the merged result breaks a rule', async () => {
      repo.update.mockResolvedValue({
        outcome: 'invalid',
        errors: [
          {
            field: 'minShopperFee',
            message: 'minShopperFee (9000) must not be more than maxShopperFee (5000)',
          },
        ],
      });
      const { status, json } = await call('PATCH', 'ADMIN', { minShopperFee: 9000 });
      expect(status).toBe(422);
      expect(JSON.stringify(json)).toContain('must not be more than maxShopperFee');
    });

    it('422s, not 500, when a database CHECK refuses the write', async () => {
      repo.update.mockRejectedValue(
        new ShoppingConfigConstraintError('shopping_config_fee_bounds'),
      );
      expect((await call('PATCH', 'ADMIN', { minShopperFee: 9000 })).status).toBe(422);
    });
  });
});
