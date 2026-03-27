import {
  HttpException,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';
import { createMockArgumentsHost } from '@common/test/test-helpers';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function callFilter(exception: unknown): void {
    const host = createMockArgumentsHost({ url: '/api/test', method: 'GET' }, mockResponse);
    filter.catch(exception, host);
  }

  it('should handle HttpException with string response', () => {
    callFilter(new HttpException('Not allowed', 403));
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Not allowed', error: 'Forbidden' }),
    );
  });

  it('should handle HttpException with object response and extract message', () => {
    callFilter(new NotFoundException('User not found'));
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'User not found', error: 'Not Found' }),
    );
  });

  it('should include code field when present in response', () => {
    callFilter(new HttpException({ message: 'Invalid', code: 'AUTH_INVALID' }, 401));
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.code).toBe('AUTH_INVALID');
  });

  it('should format validation errors from array message', () => {
    callFilter(
      new BadRequestException({
        message: ['email must be valid', 'name should not be empty'],
      }),
    );
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.message).toBe('Validation failed');
    expect(body.details).toHaveLength(2);
    expect(body.details[0]).toHaveProperty('field');
    expect(body.details[0]).toHaveProperty('message', 'email must be valid');
  });

  it('should include details when present in response object', () => {
    callFilter(new HttpException({ message: 'Bad', details: { foo: 'bar' } }, 400));
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.details).toEqual({ foo: 'bar' });
  });

  it('should handle non-HttpException Error with 500', () => {
    callFilter(new Error('something broke'));
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'something broke', statusCode: 500 }),
    );
  });

  it('should handle unknown non-Error exception with 500', () => {
    callFilter('string error');
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error', statusCode: 500 }),
    );
  });

  it('should map known status codes to error names', () => {
    callFilter(new HttpException('x', 429));
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Too Many Requests' }),
    );
  });

  it('should log 5xx as error and 4xx as warn', () => {
    callFilter(new NotFoundException('gone'));
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockClear();
    errorSpy.mockClear();

    callFilter(new InternalServerErrorException('boom'));
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should include success, path, and timestamp in response', () => {
    callFilter(new BadRequestException('bad'));
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.path).toBe('/api/test');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
