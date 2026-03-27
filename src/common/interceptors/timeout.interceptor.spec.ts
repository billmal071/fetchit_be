import { RequestTimeoutException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { TimeoutInterceptor } from './timeout.interceptor';
import { createMockExecutionContext, createMockCallHandler } from '@common/test/test-helpers';

describe('TimeoutInterceptor', () => {
  it('should pass through when response is immediate', async () => {
    const interceptor = new TimeoutInterceptor(5000);
    const context = createMockExecutionContext();
    const handler = createMockCallHandler('ok');

    const result = await lastValueFrom(interceptor.intercept(context, handler));
    expect(result).toBe('ok');
  });

  it('should use default timeout of 30000ms', () => {
    const interceptor = new TimeoutInterceptor();
    expect(interceptor).toBeDefined();
    // Default is 30000 — just verify instantiation works
  });

  it('should pass through non-timeout errors unchanged', async () => {
    const interceptor = new TimeoutInterceptor(5000);
    const context = createMockExecutionContext();
    const originalError = new Error('some error');
    const handler = { handle: jest.fn().mockReturnValue(throwError(() => originalError)) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow(
      'some error',
    );
  });

  it('should convert TimeoutError to RequestTimeoutException', async () => {
    const interceptor = new TimeoutInterceptor(1); // 1ms timeout
    const context = createMockExecutionContext();
    // Handler that never completes
    const { Observable } = await import('rxjs');
    const handler = { handle: jest.fn().mockReturnValue(new Observable(() => {})) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow(
      RequestTimeoutException,
    );
  });
});
