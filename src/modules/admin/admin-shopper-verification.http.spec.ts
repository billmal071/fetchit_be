/**
 * HTTP-level wiring test for the shopper review endpoints.
 *
 * What is at risk is the wiring, not the service: that only an ADMIN can reach
 * these routes (a shopper approving their own application would unlock the
 * request feed and going online), and that the global ValidationPipe is what
 * rejects a blank reason or an unknown `state`. So this boots a real Nest app
 * around the real controller and service, installs the real RolesGuard the way
 * AppModule does, stubs only the repository and audit log, and talks to it over
 * HTTP. Same pattern as update-me-status.http.spec.ts.
 */
import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { ShopperAccountState } from '@prisma/client';
import { GlobalExceptionFilter } from '@/common/filters';
import { RolesGuard } from '@/common/guards';
import { SHOPPER_PROFILE_REPOSITORY } from '@/database/repositories';
import { AuditService } from '@common/services/audit.service';
import { AdminShopperVerificationController } from './admin-shopper-verification.controller';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminShopperVerificationService } from './admin-shopper-verification.service';

const application = (accountState: ShopperAccountState): Record<string, unknown> => ({
  id: 'profile-1',
  userId: 'user-1',
  accountState,
  displayName: 'Amaka O.',
  bio: 'Six years buying for restaurants around Mile 12.',
  isOnline: false,
  rating: null,
  completedOrders: 0,
  completionRate: null,
  payoutAccountVerified: false,
  rejectionReason: null,
  submittedAt: new Date('2026-11-20T10:00:00.000Z'),
  reviewedById: null,
  reviewedAt: null,
  yearsOfExperience: null,
  createdAt: new Date('2026-11-20T09:00:00.000Z'),
  updatedAt: new Date('2026-11-20T10:00:00.000Z'),
  categories: [],
  locations: [],
  services: [],
  availability: [],
  user: { id: 'user-1', username: 'amaka', email: 'amaka@example.com', phone: null, avatar: null },
});

const repo = {
  findApplications: jest.fn(),
  findApplicationById: jest.fn(),
  transitionState: jest.fn(),
};
const audit = { log: jest.fn() };

@Module({
  controllers: [AdminShopperVerificationController],
  providers: [
    AdminShopperVerificationService,
    { provide: SHOPPER_PROFILE_REPOSITORY, useValue: repo },
    { provide: AuditService, useValue: audit },
    { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Stands in for JwtAuthGuard: the caller's role comes from a test header.
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        const role = req.header('x-test-role');
        if (role) {
          (req as Request & { user: unknown }).user = { id: `${role}-1`, role };
        }
        next();
      })
      .forRoutes('(.*)');
  }
}

describe('shopper verification (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  const call = (method: string, path: string, role?: string, body?: unknown): Promise<Response> =>
    fetch(`${baseUrl}/admin/shopper-verification${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { 'x-test-role': role } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    // Mirror main.ts exactly, implicit conversion included.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findApplications.mockResolvedValue({
      rows: [application(ShopperAccountState.VERIFICATION_PENDING)],
      total: 1,
    });
    repo.findApplicationById.mockResolvedValue(
      application(ShopperAccountState.VERIFICATION_PENDING),
    );
    repo.transitionState.mockResolvedValue(true);
    audit.log.mockResolvedValue(undefined);
  });

  describe('who can reach it', () => {
    const routes: Array<[string, string, unknown?]> = [
      ['GET', '', undefined],
      ['GET', '/profile-1', undefined],
      ['PATCH', '/profile-1/approve', undefined],
      ['PATCH', '/profile-1/reject', { reason: 'Add a market.' }],
    ];

    it.each(routes)(
      '%s %s is refused to a shopper, who must not approve themselves',
      async (method, path, body) => {
        const res = await call(method, path, 'PERSONAL_SHOPPER', body);

        expect(res.status).toBe(403);
        expect(repo.findApplications).not.toHaveBeenCalled();
        expect(repo.findApplicationById).not.toHaveBeenCalled();
        expect(repo.transitionState).not.toHaveBeenCalled();
      },
    );

    it.each(['CUSTOMER', 'HANDYMAN'])('is refused to a %s', async (role) => {
      expect((await call('PATCH', '/profile-1/approve', role)).status).toBe(403);
      expect(repo.transitionState).not.toHaveBeenCalled();
    });

    it('is refused when nobody is signed in', async () => {
      expect((await call('PATCH', '/profile-1/approve')).status).toBe(403);
      expect(repo.transitionState).not.toHaveBeenCalled();
    });
  });

  describe('as an admin', () => {
    it('lists pending applications by default', async () => {
      const res = await call('GET', '', 'ADMIN');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(repo.findApplications).toHaveBeenCalledWith(
        ShopperAccountState.VERIFICATION_PENDING,
        0,
        10,
      );
      expect(body.data[0].user.email).toBe('amaka@example.com');
      expect(body.meta.total).toBe(1);
    });

    it('lists another stage, with paging', async () => {
      await call('GET', '?state=APPROVED&page=2&limit=5', 'ADMIN');

      expect(repo.findApplications).toHaveBeenCalledWith(ShopperAccountState.APPROVED, 5, 5);
    });

    it('rejects an unknown state', async () => {
      expect((await call('GET', '?state=BOGUS', 'ADMIN')).status).toBe(400);
      expect(repo.findApplications).not.toHaveBeenCalled();
    });

    it('approves a pending application', async () => {
      repo.findApplicationById
        .mockResolvedValueOnce(application(ShopperAccountState.VERIFICATION_PENDING))
        .mockResolvedValueOnce(application(ShopperAccountState.APPROVED));

      const res = await call('PATCH', '/profile-1/approve', 'ADMIN');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.accountState).toBe('APPROVED');
      expect(repo.transitionState).toHaveBeenCalledWith(
        'profile-1',
        'VERIFICATION_PENDING',
        'APPROVED',
        'ADMIN-1',
        null,
      );
    });

    it('refuses to approve what is not pending', async () => {
      repo.findApplicationById.mockResolvedValue(application(ShopperAccountState.REGISTERED));

      const res = await call('PATCH', '/profile-1/approve', 'ADMIN');

      expect(res.status).toBe(400);
      expect(repo.transitionState).not.toHaveBeenCalled();
    });

    it('is a 404 for an unknown application', async () => {
      repo.findApplicationById.mockResolvedValue(null);

      expect((await call('PATCH', '/nope/approve', 'ADMIN')).status).toBe(404);
    });

    it('sends an application back with a reason', async () => {
      const res = await call('PATCH', '/profile-1/reject', 'ADMIN', {
        reason: '  Add a market you know well.  ',
      });

      expect(res.status).toBe(200);
      // Trimmed by the DTO before it reaches the service.
      expect(repo.transitionState).toHaveBeenCalledWith(
        'profile-1',
        'VERIFICATION_PENDING',
        'VERIFICATION_REQUIRES_UPDATE',
        'ADMIN-1',
        'Add a market you know well.',
      );
    });

    it.each([{}, { reason: '' }, { reason: '   ' }, { reason: 42 }, { reason: 'x'.repeat(1001) }])(
      'rejects a bad reason %j',
      async (body) => {
        expect((await call('PATCH', '/profile-1/reject', 'ADMIN', body)).status).toBe(400);
        expect(repo.transitionState).not.toHaveBeenCalled();
      },
    );

    it('rejects fields it does not know', async () => {
      const res = await call('PATCH', '/profile-1/reject', 'ADMIN', {
        reason: 'Add a market.',
        accountState: 'APPROVED',
      });

      expect(res.status).toBe(400);
      expect(repo.transitionState).not.toHaveBeenCalled();
    });
  });
});
