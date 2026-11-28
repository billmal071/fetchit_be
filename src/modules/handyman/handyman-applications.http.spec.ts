/**
 * HTTP-level test for GET /handyman/applications.
 *
 * Boots the real HandymanModule (repositories stubbed) so the route, the
 * production ValidationPipe options and JSON serialisation are exercised, and
 * asserts each application is returned with its service request nested.
 */
import { Global, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { configuration } from '@/config';
import { GlobalExceptionFilter } from '@/common/filters';
import { PrismaService } from '@/database/prisma.service';
import {
  HANDYMAN_PROFILE_REPOSITORY,
  HANDYMAN_DOCUMENT_REPOSITORY,
  SERVICE_REQUEST_REPOSITORY,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
} from '@/database/repositories';
import { StorageService } from '@/storage';
import { AuditService } from '@common/services/audit.service';
import { FeatureFlagService } from '@modules/feature-flags/feature-flag.service';
import { HandymanModule } from './handyman.module';

const PROFILE_ID = 'profile-1';
const USER = { id: 'user-1', email: 'handyman@example.com', role: 'HANDYMAN' };

const category = {
  id: 'cat-1',
  name: 'Plumbing',
  slug: 'plumbing',
  description: null,
  icon: null,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const makeApplication = (id: string, status: string, requestStatus: string): object => ({
  id,
  serviceRequestId: `req-${id}`,
  handymanProfileId: PROFILE_ID,
  coverMessage: null,
  proposedRate: null,
  status,
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  serviceRequest: {
    id: `req-${id}`,
    customerId: 'cust-1',
    categoryId: category.id,
    title: 'Fix sink',
    description: 'Leaking',
    location: 'Lagos',
    latitude: null,
    longitude: null,
    budgetMin: null,
    budgetMax: null,
    status: requestStatus,
    assignedHandymanId: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    category,
    customer: { id: 'cust-1', username: 'jane', avatar: null },
    _count: { applications: 2 },
  },
});

const profileRepo = { ensureByUserId: jest.fn(async () => ({ id: PROFILE_ID })) };
const applicationRepo = { findByHandymanProfileId: jest.fn() };

@Global()
@Module({
  providers: [
    { provide: HANDYMAN_PROFILE_REPOSITORY, useValue: profileRepo },
    { provide: HANDYMAN_DOCUMENT_REPOSITORY, useValue: {} },
    { provide: SERVICE_REQUEST_REPOSITORY, useValue: {} },
    { provide: SERVICE_REQUEST_APPLICATION_REPOSITORY, useValue: applicationRepo },
    { provide: PrismaService, useValue: {} },
    { provide: StorageService, useValue: {} },
    { provide: AuditService, useValue: { log: jest.fn() } },
    { provide: FeatureFlagService, useValue: { isEnabledFor: async () => true } },
  ],
  exports: [
    HANDYMAN_PROFILE_REPOSITORY,
    HANDYMAN_DOCUMENT_REPOSITORY,
    SERVICE_REQUEST_REPOSITORY,
    SERVICE_REQUEST_APPLICATION_REPOSITORY,
    PrismaService,
    StorageService,
    AuditService,
    FeatureFlagService,
  ],
})
class StubsModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    StubsModule,
    HandymanModule,
  ],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        (req as Request & { user: typeof USER }).user = USER;
        next();
      })
      .forRoutes('(.*)');
  }
}

describe('GET /handyman/applications (HTTP)', () => {
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
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    profileRepo.ensureByUserId.mockResolvedValue({ id: PROFILE_ID });
  });

  it('returns each application with its service request nested', async () => {
    applicationRepo.findByHandymanProfileId.mockResolvedValue([
      makeApplication('a1', 'ACCEPTED', 'ASSIGNED'),
      makeApplication('a2', 'REJECTED', 'OPEN'),
    ]);

    const res = await fetch(`${baseUrl}/handyman/applications`);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        status: string;
        serviceRequest: {
          id: string;
          status: string;
          title: string;
          category: { name: string };
          customer: Record<string, unknown>;
        };
      }>;
    };

    expect(res.status).toBe(200);
    expect(applicationRepo.findByHandymanProfileId).toHaveBeenCalledWith(PROFILE_ID);
    expect(body.data.map((a) => [a.status, a.serviceRequest.status])).toEqual([
      ['ACCEPTED', 'ASSIGNED'],
      ['REJECTED', 'OPEN'],
    ]);
    expect(body.data[0].serviceRequest).toMatchObject({
      id: 'req-a1',
      title: 'Fix sink',
      category: { name: 'Plumbing' },
      customer: { id: 'cust-1', username: 'jane', avatar: null },
      _count: { applications: 2 },
    });
    expect(Object.keys(body.data[0].serviceRequest.customer).sort()).toEqual([
      'avatar',
      'id',
      'username',
    ]);
  });

  it('returns an empty list when the handyman has no applications', async () => {
    applicationRepo.findByHandymanProfileId.mockResolvedValue([]);

    const res = await fetch(`${baseUrl}/handyman/applications`);
    const body = (await res.json()) as { data: unknown[] };

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
