import { lastValueFrom } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';
import { createMockExecutionContext, createMockCallHandler } from '@common/test/test-helpers';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
  });

  it('should wrap plain data in standard response format', async () => {
    const context = createMockExecutionContext();
    const handler = createMockCallHandler({ id: 1, name: 'test' });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result.success).toBe(true);
    expect(result.message).toBe('Success');
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.timestamp).toBeDefined();
  });

  it('should unwrap IResponseData shape and extract data', async () => {
    const context = createMockExecutionContext();
    const handler = createMockCallHandler({ data: { id: 1 }, message: 'Created' });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result.data).toEqual({ id: 1 });
    expect(result.message).toBe('Created');
  });

  it('should use default message when IResponseData has no message', async () => {
    const context = createMockExecutionContext();
    const handler = createMockCallHandler({ data: { id: 1 } });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result.message).toBe('Success');
  });

  it('should preserve meta when present in IResponseData', async () => {
    const meta = {
      page: 1,
      limit: 10,
      total: 50,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: false,
    };
    const context = createMockExecutionContext();
    const handler = createMockCallHandler({ data: [1, 2], meta });

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result.meta).toEqual(meta);
  });

  it('should not include meta when not present', async () => {
    const context = createMockExecutionContext();
    const handler = createMockCallHandler('simple string');

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).not.toHaveProperty('meta');
  });

  it('should set timestamp as ISO string', async () => {
    const context = createMockExecutionContext();
    const handler = createMockCallHandler(null);

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
