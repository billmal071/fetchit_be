import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';
import { ERROR_MESSAGES } from '../constants';

export class DomainException extends BaseException {
  constructor(
    message: string,
    public readonly code: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    super(message, statusCode, details, code);
  }
}

// ==================== AUTHENTICATION EXCEPTIONS ====================

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(ERROR_MESSAGES.INVALID_CREDENTIALS, 'AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('Authentication token has expired', 'AUTH_TOKEN_EXPIRED', HttpStatus.UNAUTHORIZED);
  }
}

export class EmailNotVerifiedException extends DomainException {
  constructor() {
    super(
      'Email not verified. Please verify your email to continue.',
      'AUTH_EMAIL_NOT_VERIFIED',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class InvalidTokenException extends DomainException {
  constructor(tokenType: string = 'token') {
    super(`Invalid ${tokenType}`, 'AUTH_INVALID_TOKEN', HttpStatus.UNAUTHORIZED, { tokenType });
  }
}

export class InvalidAdminSecretException extends DomainException {
  constructor() {
    super('Invalid admin secret', 'AUTH_INVALID_ADMIN_SECRET', HttpStatus.FORBIDDEN);
  }
}

// ==================== RESOURCE EXCEPTIONS ====================

export class ResourceNotFoundException extends DomainException {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      'RESOURCE_NOT_FOUND',
      HttpStatus.NOT_FOUND,
      { resource, id },
    );
  }
}

export class ResourceAlreadyExistsException extends DomainException {
  constructor(resource: string, field: string, value: string) {
    super(
      `${resource} with ${field} "${value}" already exists`,
      'RESOURCE_ALREADY_EXISTS',
      HttpStatus.CONFLICT,
      { resource, field, value },
    );
  }
}

// ==================== HANDYMAN EXCEPTIONS ====================

export class HandymanProfileNotFoundException extends DomainException {
  constructor() {
    super('Handyman profile not found', 'HANDYMAN_PROFILE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}

export class HandymanNotVerifiedException extends DomainException {
  constructor() {
    super(
      'You must be verified to perform this action',
      'HANDYMAN_NOT_VERIFIED',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class InvalidVerificationTransitionException extends DomainException {
  constructor(from: string, to: string) {
    super(
      `Cannot transition from ${from} to ${to}`,
      'INVALID_VERIFICATION_TRANSITION',
      HttpStatus.BAD_REQUEST,
      { from, to },
    );
  }
}

export class DuplicateApplicationException extends DomainException {
  constructor() {
    super(
      'You have already applied to this service request',
      'DUPLICATE_APPLICATION',
      HttpStatus.CONFLICT,
    );
  }
}

export class ServiceRequestNotOpenException extends DomainException {
  constructor() {
    super(
      'This service request is no longer accepting applications',
      'SERVICE_REQUEST_NOT_OPEN',
      HttpStatus.BAD_REQUEST,
    );
  }
}
