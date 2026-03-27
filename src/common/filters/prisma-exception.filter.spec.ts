import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';
import { createMockArgumentsHost } from '@common/test/test-helpers';

function createPrismaError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: '5.0.0',
    meta,
  });
}

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };

  beforeEach(() => {
    // BaseExceptionFilter needs an httpAdapter; pass null and override catch
    filter = new PrismaExceptionFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function callFilter(code: string, meta?: Record<string, unknown>): void {
    const host = createMockArgumentsHost({ url: '/api/test' }, mockResponse);
    filter.catch(createPrismaError(code, meta), host);
  }

  it('should return 400 for P2000 (value too long)', () => {
    callFilter('P2000');
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Input value is too long for a field.' }),
    );
  });

  it('should return 409 for P2002 with array target', () => {
    callFilter('P2002', { target: ['email', 'username'] });
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('email, username'),
        error: 'Conflict',
      }),
    );
  });

  it('should return 409 for P2002 with string target', () => {
    callFilter('P2002', { target: 'email' });
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('email') }),
    );
  });

  it('should return 404 for P2025 with cause in meta', () => {
    callFilter('P2025', { cause: 'Record to update not found.' });
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Record to update not found.' }),
    );
  });

  it('should return 404 for P2025 with default message when no cause', () => {
    callFilter('P2025');
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Resource not found.' }),
    );
  });

  it('should return 400 for P2003 (foreign key)', () => {
    callFilter('P2003');
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid Foreign Key' }),
    );
  });

  it('should return 500 for unknown Prisma error codes', () => {
    callFilter('P2999');
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Internal Server Error' }),
    );
  });

  it('should return IErrorResponse shape with success, path, timestamp', () => {
    callFilter('P2000');
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.path).toBe('/api/test');
    expect(body.timestamp).toBeDefined();
  });
});
