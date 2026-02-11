import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';

export class DomainException extends BaseException {
  constructor(
    message: string,
    public readonly code: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    super(message, statusCode, details);
  }
}

// ==================== AUTHENTICATION EXCEPTIONS ====================

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super(
      'AUTH_TOKEN_EXPIRED',
      'Authentication token has expired',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class EmailNotVerifiedException extends DomainException {
  constructor() {
    super(
      'AUTH_EMAIL_NOT_VERIFIED',
      'Email not verified. Please check your inbox.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class InvalidTokenException extends DomainException {
  constructor(tokenType: string = 'token') {
    super(
      'AUTH_INVALID_TOKEN',
      `Invalid ${tokenType}`,
      HttpStatus.UNAUTHORIZED,
      { tokenType },
    );
  }
}

export class InvalidAdminSecretException extends DomainException {
  constructor() {
    super(
      'AUTH_INVALID_ADMIN_SECRET',
      'Invalid admin secret',
      HttpStatus.FORBIDDEN,
    );
  }
}

// ==================== RESOURCE EXCEPTIONS ====================

export class ResourceNotFoundException extends DomainException {
  constructor(resource: string, id?: string) {
    super(
      'RESOURCE_NOT_FOUND',
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      HttpStatus.NOT_FOUND,
      { resource, id },
    );
  }
}

export class ResourceAlreadyExistsException extends DomainException {
  constructor(resource: string, field: string, value: string) {
    super(
      'RESOURCE_ALREADY_EXISTS',
      `${resource} with ${field} "${value}" already exists`,
      HttpStatus.CONFLICT,
      { resource, field, value },
    );
  }
}
