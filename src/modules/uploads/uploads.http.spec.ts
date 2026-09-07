/**
 * HTTP-level wiring test for the generic upload route.
 *
 * Mirrors `handyman-upload.http.spec.ts`: a unit test of the controller would
 * pass even with the multipart interceptor, the size limit or the validation
 * pipe unwired, so this boots a real Nest app around the real UploadsModule
 * (only the storage provider is stubbed) and talks to it over HTTP.
 */

// Set before `configuration()` is loaded so the multer limit under test is a
// small, fast-to-exercise number rather than the 5 MB production default.
const originalMaxFileSize = process.env.STORAGE_MAX_FILE_SIZE;
process.env.STORAGE_MAX_FILE_SIZE = '1024';

import { Global, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { configuration } from '@/config';
import { GlobalExceptionFilter } from '@/common/filters';
import { StorageService } from '@/storage';
import { UploadsModule } from './uploads.module';

const USER = { id: 'user-1', email: 'shopper@example.com', role: 'USER' };

const pngBytes = (padding = 0): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(padding),
  ]);

const uploads: Array<{ key: string; contentType: string; size: number }> = [];

const storageStub = {
  upload: jest.fn(async ({ key, body, contentType }) => {
    uploads.push({ key, contentType, size: body.length });
    return { key, url: `https://files.test/${key}`, size: body.length, contentType };
  }),
  delete: jest.fn(),
  getUrl: jest.fn((key: string) => `https://files.test/${key}`),
  getProviderName: jest.fn(() => 'stub'),
};

/** Global so UploadsModule resolves StorageService as it does in AppModule. */
@Global()
@Module({
  providers: [{ provide: StorageService, useValue: storageStub }],
  exports: [StorageService],
})
class StubsModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
    StubsModule,
    UploadsModule,
  ],
})
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

describe('Uploads (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    // Mirror main.ts so the pipe and filter under test behave as in production.
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
    if (originalMaxFileSize === undefined) {
      delete process.env.STORAGE_MAX_FILE_SIZE;
    } else {
      process.env.STORAGE_MAX_FILE_SIZE = originalMaxFileSize;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    uploads.length = 0;
  });

  function buildForm(
    bytes: Buffer,
    { purpose = 'AVATAR', filename = 'me.png', contentType = 'image/png' } = {},
  ): FormData {
    const data = new FormData();
    data.set('purpose', purpose);
    data.set('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
    return data;
  }

  const upload = (body: FormData): Promise<Response> =>
    fetch(`${baseUrl}/uploads`, { method: 'POST', body });

  it('stores a file under a server-generated key and returns its URL', async () => {
    const res = await upload(buildForm(pngBytes()));
    const body = (await res.json()) as { data: { key: string; url: string; contentType: string } };

    expect(res.status).toBe(201);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('image/png');
    expect(body.data.key).toMatch(new RegExp(`^avatars/${USER.id}/[0-9a-f-]{36}\\.png$`));
    expect(body.data.url).toBe(`https://files.test/${body.data.key}`);
  });

  it('prefixes receipts separately from avatars', async () => {
    const res = await upload(buildForm(pngBytes(), { purpose: 'RECEIPT' }));
    const body = (await res.json()) as { data: { key: string } };

    expect(res.status).toBe(201);
    expect(body.data.key).toMatch(new RegExp(`^receipts/${USER.id}/[0-9a-f-]{36}\\.png$`));
  });

  it('rejects a file over the configured size limit with 413', async () => {
    const res = await upload(buildForm(pngBytes(4096)));

    expect(res.status).toBe(413);
    expect(storageStub.upload).not.toHaveBeenCalled();
  });

  it('rejects bytes that are not on the allowlist, whatever the client claims', async () => {
    // A Windows executable dressed up as a PNG.
    const res = await upload(
      buildForm(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), { filename: 'me.png' }),
    );

    expect(res.status).toBe(400);
    expect(storageStub.upload).not.toHaveBeenCalled();
  });

  it('rejects an unknown purpose, so a caller cannot choose its own prefix', async () => {
    const res = await upload(buildForm(pngBytes(), { purpose: '../../etc' }));

    expect(res.status).toBe(400);
    expect(storageStub.upload).not.toHaveBeenCalled();
  });

  it('rejects a request with no file part', async () => {
    const data = new FormData();
    data.set('purpose', 'AVATAR');

    const res = await upload(data);

    expect(res.status).toBe(400);
    expect(storageStub.upload).not.toHaveBeenCalled();
  });
});
