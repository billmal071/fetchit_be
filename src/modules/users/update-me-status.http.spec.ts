/**
 * HTTP-level wiring test for bug #4.
 *
 * A class-level test of `UpdateMeDto`/`UsersController` would pass even if
 * the controller's `@Body()` metatype were swapped back to
 * `AdminUpdateUserDto` — the thing actually at risk of regressing is the
 * wiring between the route and the global `ValidationPipe`, not the DTO
 * class itself. So this boots a real Nest app around the real UsersModule
 * (only the repository is stubbed) and talks to it over HTTP, following the
 * same pattern as handyman-upload.http.spec.ts.
 */
import { Global, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { GlobalExceptionFilter } from '@/common/filters';
import { USER_REPOSITORY } from '@/database/repositories';
import { UsersModule } from './users.module';

const USER = { id: 'user-1', email: 'customer@example.com', role: 'CUSTOMER' };

const userRepo = {
  findById: jest.fn(async () => ({ id: USER.id, status: 'ACTIVE' })),
  update: jest.fn(async (id: string, data: unknown) => ({ id, ...(data as object) })),
};

@Global()
@Module({
  providers: [{ provide: USER_REPOSITORY, useValue: userRepo }],
  exports: [USER_REPOSITORY],
})
class StubsModule {}

@Module({ imports: [StubsModule, UsersModule] })
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Stands in for JwtAuthGuard populating request.user.
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        (req as Request & { user: typeof USER }).user = USER;
        next();
      })
      .forRoutes('(.*)');
  }
}

describe('PATCH /users/me (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    // Mirror main.ts exactly: this is the pipe whose whitelist/forbid options
    // are what actually rejects `status` — a unit test of the DTO class
    // alone never exercises it.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
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
    userRepo.findById.mockResolvedValue({ id: USER.id, status: 'ACTIVE' });
  });

  it('rejects status — self-suspension must not be possible via /users/me', async () => {
    const res = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });

    expect(res.status).toBe(400);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('accepts a declared field like username', async () => {
    const res = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newname' }),
    });

    expect(res.status).toBe(200);
    expect(userRepo.update).toHaveBeenCalledWith(USER.id, { username: 'newname' });
  });
});
