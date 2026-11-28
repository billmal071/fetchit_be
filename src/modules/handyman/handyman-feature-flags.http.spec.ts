/**
 * HTTP-level test of feature-flag gating on the handyman controller: only withdrawing an
 * application and cancelling an assigned job are behind `handyman_application_flows`; every
 * other handyman route stays open whatever the flag says.
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
import { configuration } from '@/config';
import { RolesGuard } from '@common/guards/roles.guard';
import { GlobalExceptionFilter } from '@/common/filters';
import { ResponseInterceptor } from '@/common/interceptors';
import { PrismaService } from '@/database/prisma.service';
import {
  FEATURE_FLAG_REPOSITORY,
  HANDYMAN_DOCUMENT_REPOSITORY,
  HANDYMAN_PROFILE_REPOSITORY,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
  SERVICE_REQUEST_REPOSITORY,
} from '@/database/repositories';
import { StorageService } from '@/storage';
import { AuditService } from '@common/services/audit.service';
import { FeatureFlagService } from '@modules/feature-flags/feature-flag.service';
import { FeatureFlagsModule } from '@modules/feature-flags/feature-flags.module';
import { HandymanModule } from './handyman.module';

const ID = '3f2b8c1e-9d4a-4b7e-8a51-0c6d2e7f9a10';
const flagRows: Array<{ key: string; enabled: boolean; allowedRoles: UserRole[] }> = [];
const profileRepo = { ensureByUserId: jest.fn(async () => ({ id: 'profile-1' })) };
const applicationRepo = {
  findByHandymanProfileId: jest.fn(async () => []),
  findById: jest.fn(async () => null),
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
    {
      provide: FEATURE_FLAG_REPOSITORY,
      useValue: { list: jest.fn(async () => flagRows.map((f) => ({ ...f }))) },
    },
    { provide: HANDYMAN_PROFILE_REPOSITORY, useValue: profileRepo },
    { provide: HANDYMAN_DOCUMENT_REPOSITORY, useValue: {} },
    { provide: SERVICE_REQUEST_REPOSITORY, useValue: { findById: jest.fn(async () => null) } },
    { provide: SERVICE_REQUEST_APPLICATION_REPOSITORY, useValue: applicationRepo },
    { provide: PrismaService, useValue: {} },
    { provide: StorageService, useValue: {} },
    { provide: AuditService, useValue: { log: jest.fn() } },
  ],
  exports: [
    FEATURE_FLAG_REPOSITORY,
    HANDYMAN_PROFILE_REPOSITORY,
    HANDYMAN_DOCUMENT_REPOSITORY,
    SERVICE_REQUEST_REPOSITORY,
    SERVICE_REQUEST_APPLICATION_REPOSITORY,
    PrismaService,
    StorageService,
    AuditService,
  ],
})
class StubsModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    StubsModule,
    FeatureFlagsModule,
    HandymanModule,
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
            email: 'h@example.com',
            role,
          };
        }
        next();
      })
      .forRoutes('(.*)');
  }
}

describe('feature-flag gating: handyman controller (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  const FLAG = 'handyman_application_flows';
  const setFlag = (flag: { enabled?: boolean; allowedRoles?: UserRole[] }): void => {
    flagRows.length = 0;
    flagRows.push({ key: FLAG, enabled: true, allowedRoles: [], ...flag });
    app.get(FeatureFlagService).invalidate();
  };
  const call = async (
    role: string | null,
    method: string,
    path: string,
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const disabled = (r: { status: number; json: any }): boolean =>
    r.status === 404 && r.json?.code === 'FEATURE_DISABLED';

  const GATED: Array<[string, string]> = [
    ['DELETE', `/handyman/applications/${ID}`],
    ['PATCH', `/handyman/service-requests/${ID}/cancel`],
  ];
  const OPEN: Array<[string, string]> = [
    ['GET', '/handyman/applications'],
    ['PATCH', `/handyman/service-requests/${ID}/start`],
    ['PATCH', `/handyman/service-requests/${ID}/complete`],
  ];

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
  beforeEach(() => setFlag({}));

  it.each(GATED)('%s %s is 401 with no user, even when the flag is off', async (method, path) => {
    setFlag({ enabled: false });
    expect((await call(null, method, path)).status).toBe(401);
  });

  it.each(GATED)('%s %s is 404 FEATURE_DISABLED when the flag is off', async (method, path) => {
    setFlag({ enabled: false });
    const result = await call('HANDYMAN', method, path);
    expect(result.status).toBe(404);
    expect(result.json).toMatchObject({
      message: 'This feature is not available yet',
      code: 'FEATURE_DISABLED',
    });
  });

  it.each(GATED)('%s %s is handled normally when the flag is on', async (method, path) => {
    const result = await call('HANDYMAN', method, path);
    expect(disabled(result)).toBe(false);
    expect(result.status).not.toBe(401);
  });

  it.each(GATED)(
    '%s %s with the flag limited to other roles is off for a HANDYMAN',
    async (method, path) => {
      setFlag({ allowedRoles: [UserRole.CUSTOMER] });
      expect(disabled(await call('HANDYMAN', method, path))).toBe(true);
      setFlag({ allowedRoles: [UserRole.HANDYMAN] });
      expect(disabled(await call('HANDYMAN', method, path))).toBe(false);
    },
  );

  it.each(OPEN)('%s %s is never gated, whatever the flag says', async (method, path) => {
    setFlag({ enabled: false });
    expect(disabled(await call('HANDYMAN', method, path))).toBe(false);
  });

  it('a missing flag row fails closed on the gated routes and leaves the rest alone', async () => {
    flagRows.length = 0;
    app.get(FeatureFlagService).invalidate();
    expect(disabled(await call('HANDYMAN', 'DELETE', `/handyman/applications/${ID}`))).toBe(true);
    expect(disabled(await call('HANDYMAN', 'GET', '/handyman/applications'))).toBe(false);
  });
});
