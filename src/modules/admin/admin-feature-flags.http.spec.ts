/**
 * HTTP-level test for GET /admin/feature-flags and PATCH /admin/feature-flags/:key: the real
 * controller and service behind the production ValidationPipe options and the real RolesGuard,
 * with the repository, flag cache and audit log stubbed.
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
import { FEATURE_FLAG_REPOSITORY } from '@/database/repositories';
import { AuditService } from '@common/services/audit.service';
import { FeatureFlagService } from '@modules/feature-flags/feature-flag.service';
import { AdminFeatureFlagsController } from './admin-feature-flags.controller';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

const RECORD = {
  key: 'shopper_orders',
  description: 'Orders',
  enabled: false,
  allowedRoles: ['CUSTOMER'],
  updatedAt: new Date('2026-11-27T10:00:00.000Z'),
  updatedBy: { id: 'admin-1', username: 'ada' },
};
const repo = { list: jest.fn(), update: jest.fn() };
const audit = { log: jest.fn() };
const flags = { invalidate: jest.fn() };

class RequireUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (!req.user) throw new UnauthorizedException();
    return true;
  }
}

@Module({
  controllers: [AdminFeatureFlagsController],
  providers: [
    AdminFeatureFlagsService,
    { provide: FEATURE_FLAG_REPOSITORY, useValue: repo },
    { provide: FeatureFlagService, useValue: flags },
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

describe('/admin/feature-flags (HTTP)', () => {
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
    repo.list.mockResolvedValue([RECORD]);
    audit.log.mockResolvedValue(undefined);
  });

  const call = async (
    method: string,
    role: string | null,
    path = '',
    body?: unknown,
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/admin/feature-flags${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const patch = (body: unknown, key = 'shopper_orders') => call('PATCH', 'ADMIN', `/${key}`, body);

  describe('who may call it', () => {
    it.each(['GET', 'PATCH'])('%s is 401 without a user', async (method) => {
      const path = method === 'PATCH' ? '/shopper_orders' : '';
      const body = method === 'PATCH' ? {} : undefined;
      expect((await call(method, null, path, body)).status).toBe(401);
    });

    it.each(['CUSTOMER', 'PERSONAL_SHOPPER', 'HANDYMAN'])(
      '%s gets 403 on GET and PATCH',
      async (role) => {
        expect((await call('GET', role)).status).toBe(403);
        expect((await call('PATCH', role, '/shopper_orders', { enabled: false })).status).toBe(403);
        expect(repo.list).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      },
    );
  });

  it('GET returns the flags in the success envelope', async () => {
    const { status, json } = await call('GET', 'ADMIN');
    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true });
    expect(json.data).toEqual([
      {
        key: 'shopper_orders',
        description: 'Orders',
        enabled: false,
        allowedRoles: ['CUSTOMER'],
        updatedAt: '2026-11-27T10:00:00.000Z',
        updatedBy: { id: 'admin-1', username: 'ada' },
      },
    ]);
  });

  describe('PATCH', () => {
    it('updates and returns the flag with a message', async () => {
      repo.update.mockResolvedValue({
        outcome: 'updated',
        before: { enabled: true },
        after: { enabled: false },
        record: RECORD,
      });
      const { status, json } = await patch({ enabled: false, allowedRoles: ['CUSTOMER'] });
      expect(status).toBe(200);
      expect(json.message).toBe('Feature flag updated');
      expect(json.data).toMatchObject({ key: 'shopper_orders', enabled: false });
      expect(repo.update).toHaveBeenCalledWith(
        'shopper_orders',
        { enabled: false, allowedRoles: ['CUSTOMER'] },
        'admin-1',
        expect.any(Function),
      );
    });

    it('accepts an empty allowedRoles list (everyone)', async () => {
      repo.update.mockResolvedValue({ outcome: 'unchanged', record: RECORD });
      expect((await patch({ allowedRoles: [] })).status).toBe(200);
      expect(repo.update).toHaveBeenCalledWith(
        'shopper_orders',
        { allowedRoles: [] },
        'admin-1',
        expect.any(Function),
      );
    });

    it('is 404 for an unknown key', async () => {
      repo.update.mockResolvedValue({ outcome: 'not_found' });
      const { status, json } = await patch({ enabled: true }, 'nope');
      expect(status).toBe(404);
      expect(json.message).toBe('Feature flag not found');
    });

    it.each([
      ['empty body', {}],
      ['string boolean', { enabled: 'true' }],
      ['null enabled', { enabled: null }],
      ['number enabled', { enabled: 1 }],
      ['null roles', { allowedRoles: null }],
      ['roles not an array', { allowedRoles: 'CUSTOMER' }],
      ['unknown role', { allowedRoles: ['KING'] }],
      ['duplicate roles', { allowedRoles: ['CUSTOMER', 'CUSTOMER'] }],
      [
        'too many roles',
        { allowedRoles: ['CUSTOMER', 'HANDYMAN', 'ADMIN', 'PERSONAL_SHOPPER', 'X'] },
      ],
      ['unknown field', { enabled: true, description: 'hax' }],
    ])('rejects %s with 400 and writes nothing', async (_name, body) => {
      const { status } = await patch(body);
      expect(status).toBe(400);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
