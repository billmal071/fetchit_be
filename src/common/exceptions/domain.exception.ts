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

// Bug #13: login/refresh never checked `status`, so a suspended user still
// got tokens and only found out something was wrong on the *next* request,
// from JwtStrategy's generic "account is not active" 401 — a confusing
// error for a problem login/refresh could have reported clearly up front.
export class AccountSuspendedException extends DomainException {
  constructor() {
    // Deliberately not "suspended" specifically — UserStatus also has
    // INACTIVE, and an admin can set either via PATCH /users/:id. Naming
    // the wrong reason would be worse than this generic one.
    super(
      'This account is not active. Contact support for assistance.',
      'AUTH_ACCOUNT_SUSPENDED',
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

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('User with this email already exists', 'USER_EMAIL_EXISTS', HttpStatus.CONFLICT);
  }
}

export class UsernameAlreadyExistsException extends DomainException {
  constructor() {
    super('User with this username already exists', 'USER_USERNAME_EXISTS', HttpStatus.CONFLICT);
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

export class ApplicationNotPendingException extends DomainException {
  constructor() {
    super(
      'This application has already been decided and can no longer be accepted or rejected',
      'APPLICATION_NOT_PENDING',
      HttpStatus.CONFLICT,
    );
  }
}

export class ApplicationNotWithdrawableException extends DomainException {
  constructor() {
    super(
      'Only a pending application can be withdrawn',
      'APPLICATION_NOT_WITHDRAWABLE',
      HttpStatus.CONFLICT,
    );
  }
}

export class CategoryNotServicedException extends DomainException {
  constructor() {
    super(
      "You can only apply to requests in your profile's service categories",
      'CATEGORY_NOT_SERVICED',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class ServiceRequestStatusChangedException extends DomainException {
  constructor() {
    super(
      'This service request changed status and can no longer be cancelled',
      'SERVICE_REQUEST_STATUS_CHANGED',
      HttpStatus.CONFLICT,
    );
  }
}
