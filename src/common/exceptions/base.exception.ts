import { HttpException, HttpStatus } from '@nestjs/common';

export class BaseException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly details?: Record<string, unknown>,
    code?: string,
  ) {
    super(
      {
        message,
        statusCode,
        ...(details !== undefined && { details }),
        ...(code !== undefined && { code }),
      },
      statusCode,
    );
  }
}

export class NotFoundException extends BaseException {
  constructor(resource: string = 'Resource', details?: Record<string, unknown>) {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, details);
  }
}

export class BadRequestException extends BaseException {
  constructor(message: string = 'Bad request', details?: Record<string, unknown>) {
    super(message, HttpStatus.BAD_REQUEST, details);
  }
}

export class UnauthorizedException extends BaseException {
  constructor(message: string = 'Unauthorized', details?: Record<string, unknown>) {
    super(message, HttpStatus.UNAUTHORIZED, details);
  }
}

export class ForbiddenException extends BaseException {
  constructor(message: string = 'Forbidden', details?: Record<string, unknown>) {
    super(message, HttpStatus.FORBIDDEN, details);
  }
}

export class ConflictException extends BaseException {
  constructor(message: string = 'Conflict', details?: Record<string, unknown>) {
    super(message, HttpStatus.CONFLICT, details);
  }
}

export class ValidationException extends BaseException {
  constructor(
    errors: Array<{ field: string; message: string }>,
    message: string = 'Validation failed',
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, { errors });
  }
}

export class InternalServerException extends BaseException {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}
