import { Logger } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import { createMockExecutionContext, createMockCallHandler } from '@common/test/test-helpers';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log method, url, status code and duration on success', async () => {
    const context = createMockExecutionContext({
      request: { method: 'GET', url: '/api/test', ip: '127.0.0.1', headers: {} },
    });
    const handler = createMockCallHandler('ok');

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GET /api/test 200'));
  });

  it('should log error message on failure', async () => {
    const context = createMockExecutionContext({
      request: { method: 'POST', url: '/api/fail', ip: '127.0.0.1', headers: {} },
    });
    const handler = { handle: jest.fn().mockReturnValue(throwError(() => new Error('boom'))) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow('boom');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('should include correlation ID from x-correlation-id header', async () => {
    const context = createMockExecutionContext({
      request: {
        method: 'GET',
        url: '/api/test',
        ip: '127.0.0.1',
        headers: { 'x-correlation-id': 'abc-123' },
      },
    });
    const handler = createMockCallHandler('ok');

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[abc-123]'));
  });

  it('should fall back to "-" when no correlation ID', async () => {
    const context = createMockExecutionContext({
      request: { method: 'GET', url: '/test', ip: '127.0.0.1', headers: {} },
    });
    const handler = createMockCallHandler('ok');

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[-]'));
  });
});
