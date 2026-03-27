import { ExecutionContext, CallHandler, ArgumentsHost } from '@nestjs/common';
import { of } from 'rxjs';
import { IRequestUser } from '../interfaces';

export function createMockExecutionContext(
  overrides: Partial<{
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    handler: () => void;
    class: new () => unknown;
  }> = {},
): ExecutionContext {
  const headers: Record<string, string> = {};
  const request: Record<string, unknown> = {
    method: 'GET',
    url: '/test',
    ip: '127.0.0.1',
    headers,
    get: jest.fn((name: string) => headers[name.toLowerCase()]),
    user: undefined,
    ...overrides.request,
  };

  const response = {
    statusCode: 200,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    ...overrides.response,
  };

  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue(response),
    }),
    getHandler: jest.fn().mockReturnValue(overrides.handler || ((): void => {})),
    getClass: jest.fn().mockReturnValue(overrides.class || class {}),
    getType: jest.fn().mockReturnValue('http'),
    getArgs: jest.fn().mockReturnValue([request, response]),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
  } as unknown as ExecutionContext;
}

export function createMockCallHandler<T = unknown>(returnValue?: T): CallHandler {
  return {
    handle: jest.fn().mockReturnValue(of(returnValue)),
  };
}

export function createMockArgumentsHost(
  request?: Record<string, unknown>,
  response?: Record<string, unknown>,
): ArgumentsHost {
  const req = {
    url: '/test',
    method: 'GET',
    ...request,
  };

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    ...response,
  };

  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(req),
      getResponse: jest.fn().mockReturnValue(res),
    }),
    getArgs: jest.fn().mockReturnValue([req, res]),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
    getType: jest.fn().mockReturnValue('http'),
  } as unknown as ArgumentsHost;
}

export function mockUser(role = 'CUSTOMER', overrides: Partial<IRequestUser> = {}): IRequestUser {
  return {
    id: 'user-uuid-123',
    email: 'test@example.com',
    role,
    ...overrides,
  };
}
