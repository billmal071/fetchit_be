/**
 * HTTP-level wiring test for the document upload route.
 *
 * A unit test of the controller method would pass even if the multipart
 * interceptor, the size limit or the validation pipe were never wired up —
 * exactly the class of bug that has shipped from this repo before. So this
 * boots a real Nest app around the real HandymanModule (only the repositories
 * and the storage provider are stubbed) and talks to it over HTTP.
 */

// Set before `configuration()` is loaded so the multer limit under test is a
// small, fast-to-exercise number rather than the 5 MB production default.
const originalMaxFileSize = process.env.STORAGE_MAX_FILE_SIZE;
process.env.STORAGE_MAX_FILE_SIZE = '1024';

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
import { HandymanModule } from './handyman.module';

const PROFILE_ID = 'profile-1';
const USER = { id: 'user-1', email: 'handyman@example.com', role: 'HANDYMAN' };

const pdfBytes = (padding = 0): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7 test document'), Buffer.alloc(padding)]);

const documentRepo = { create: jest.fn() };
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

const profileRepo = { findByUserId: jest.fn(async () => ({ id: PROFILE_ID })) };

/**
 * Global so the real HandymanModule resolves its collaborators exactly as it
 * does in AppModule, where DatabaseModule and StorageModule are also @Global().
 */
@Global()
@Module({
  providers: [
    { provide: HANDYMAN_PROFILE_REPOSITORY, useValue: profileRepo },
    { provide: HANDYMAN_DOCUMENT_REPOSITORY, useValue: documentRepo },
    { provide: SERVICE_REQUEST_REPOSITORY, useValue: {} },
    { provide: SERVICE_REQUEST_APPLICATION_REPOSITORY, useValue: {} },
    { provide: PrismaService, useValue: {} },
    { provide: StorageService, useValue: storageStub },
  ],
  exports: [
    HANDYMAN_PROFILE_REPOSITORY,
    HANDYMAN_DOCUMENT_REPOSITORY,
    SERVICE_REQUEST_REPOSITORY,
    SERVICE_REQUEST_APPLICATION_REPOSITORY,
    PrismaService,
    StorageService,
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
    // Stands in for JwtAuthGuard populating request.user.
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        (req as Request & { user: typeof USER }).user = USER;
        next();
      })
      .forRoutes('(.*)');
  }
}

describe('Handyman document upload (HTTP)', () => {
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
    profileRepo.findByUserId.mockResolvedValue({ id: PROFILE_ID });
    documentRepo.create.mockResolvedValue({
      id: 'doc-1',
      handymanProfileId: PROFILE_ID,
      type: 'GOVERNMENT_ID',
      fileUrl: 'https://files.test/x',
      status: 'PENDING',
    });
  });

  function buildForm(
    bytes: Buffer,
    { type = 'GOVERNMENT_ID', filename = 'id.pdf', contentType = 'application/pdf' } = {},
  ): FormData {
    const data = new FormData();
    data.set('type', type);
    data.set('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
    return data;
  }

  const upload = (body: FormData): Promise<Response> =>
    fetch(`${baseUrl}/handyman/documents/upload`, { method: 'POST', body });

  describe('POST /handyman/documents/upload', () => {
    it('accepts a multipart upload and creates the document record', async () => {
      const res = await upload(buildForm(pdfBytes()));
      const body = (await res.json()) as { data: { id: string } };

      expect(res.status).toBe(201);
      expect(body.data.id).toBe('doc-1');

      expect(uploads).toHaveLength(1);
      expect(uploads[0].contentType).toBe('application/pdf');
      expect(uploads[0].key).toMatch(
        new RegExp(`^handyman-documents/${PROFILE_ID}/government_id/[0-9a-f-]{36}\\.pdf$`),
      );
      expect(documentRepo.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a file over the configured size limit with 413', async () => {
      const res = await upload(buildForm(pdfBytes(4096)));

      expect(res.status).toBe(413);
      expect(storageStub.upload).not.toHaveBeenCalled();
      expect(documentRepo.create).not.toHaveBeenCalled();
    });

    it('rejects bytes that are not on the allowlist, whatever the client claims', async () => {
      // A Windows executable dressed up as a PNG.
      const res = await upload(
        buildForm(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), {
          filename: 'selfie.png',
          contentType: 'image/png',
          type: 'SELFIE',
        }),
      );

      expect(res.status).toBe(400);
      expect(storageStub.upload).not.toHaveBeenCalled();
    });

    it('rejects an unknown document type', async () => {
      const res = await upload(buildForm(pdfBytes(), { type: 'PASSPORT' }));

      expect(res.status).toBe(400);
      expect(storageStub.upload).not.toHaveBeenCalled();
    });

    it('rejects a request with no file part', async () => {
      const data = new FormData();
      data.set('type', 'SELFIE');

      const res = await upload(data);

      expect(res.status).toBe(400);
      expect(storageStub.upload).not.toHaveBeenCalled();
    });
  });

  describe('validation error field names', () => {
    it('preserves camelCase in details[].field', async () => {
      const res = await fetch(`${baseUrl}/handyman/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json()) as {
        message: string;
        details: Array<{ field: string; message: string }>;
      };

      expect(res.status).toBe(400);
      expect(body.message).toBe('Validation failed');

      const fields = body.details.map((detail) => detail.field);
      // Regression: these used to arrive as `fileurl` / `filename`, which broke
      // field-level error mapping on the client.
      expect(fields).toContain('fileUrl');
      expect(fields).toContain('fileName');
      expect(fields).not.toContain('fileurl');
    });
  });
});
