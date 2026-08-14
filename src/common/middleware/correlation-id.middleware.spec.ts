import { Controller, Get, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ALL_ROUTES, CorrelationIdMiddleware } from './correlation-id.middleware';

@Controller('probe')
class ProbeController {
  @Get()
  probe(): { ok: boolean } {
    return { ok: true };
  }
}

/** Applies the middleware exactly as AppModule.configure() does. */
@Module({ controllers: [ProbeController] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes(ALL_ROUTES);
  }
}

/**
 * Guards against a silent regression: an unmatched forRoutes() pattern binds
 * the middleware to nothing without raising an error, so a unit test of the
 * middleware class alone would still pass while every response lost the header.
 */
describe('CorrelationIdMiddleware wiring', () => {
  let app: NestExpressApplication;
  let url: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(ProbeModule, { logger: false });
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets x-correlation-id on the response', async () => {
    const res = await fetch(`${url}/probe`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-correlation-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('echoes a client-supplied correlation id so a trace spans services', async () => {
    const res = await fetch(`${url}/probe`, {
      headers: { 'X-Correlation-ID': 'client-supplied-id' },
    });

    expect(res.headers.get('x-correlation-id')).toBe('client-supplied-id');
  });

  it('issues a distinct id per request', async () => {
    const [a, b] = await Promise.all([fetch(`${url}/probe`), fetch(`${url}/probe`)]);

    expect(a.headers.get('x-correlation-id')).not.toBe(b.headers.get('x-correlation-id'));
  });
});
