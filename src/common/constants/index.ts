export const API_CONSTANTS = {
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE: 1,
} as const;

export const CACHE_KEYS = {
  USER_BY_ID: (id: string): string => `user:${id}`,
  USER_BY_EMAIL: (email: string): string => `user:email:${email}`,
  USERS_LIST: 'users:list',
} as const;

export const CACHE_TTL = {
  ONE_MINUTE: 60,
  FIVE_MINUTES: 300,
  FIFTEEN_MINUTES: 900,
  ONE_HOUR: 3600,
  ONE_DAY: 86400,
} as const;

export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  NOTIFICATION: 'notification-queue',
  FILE_PROCESSING: 'file-processing-queue',
} as const;

export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'You are not authorized to perform this action',
  FORBIDDEN: 'Access to this resource is forbidden',
  NOT_FOUND: 'The requested resource was not found',
  INTERNAL_ERROR: 'An internal server error occurred',
  VALIDATION_ERROR: 'Validation failed',
  USER_EXISTS: 'User with this email already exists',
  USERNAME_EXISTS: 'User with this username already exists',
  INVALID_CREDENTIALS: 'Invalid email or password',
  TOKEN_EXPIRED: 'Token has expired',
  TOKEN_INVALID: 'Invalid token',
  TOKEN_ALREADY_USED: 'Token has already been used',
  PASSWORD_MISMATCH: 'Current password is incorrect',
  EMAIL_NOT_VERIFIED: 'Please verify your email first',
  EMAIL_ALREADY_VERIFIED: 'Email is already verified',
  OAUTH_USER_NO_PASSWORD: 'Cannot change password for OAuth accounts',
  HANDYMAN_PROFILE_NOT_FOUND: 'Handyman profile not found',
  HANDYMAN_NOT_VERIFIED: 'Handyman is not verified',
  INVALID_VERIFICATION_TRANSITION: 'Invalid verification status transition',
  DUPLICATE_APPLICATION: 'You have already applied to this service request',
  SERVICE_REQUEST_NOT_OPEN: 'This service request is no longer accepting applications',
} as const;

export const SUCCESS_MESSAGES = {
  USER_CREATED: 'User created successfully',
  USER_UPDATED: 'User updated successfully',
  USER_DELETED: 'User deleted successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logout successful',
  PASSWORD_RESET: 'Password reset successfully',
  PASSWORD_RESET_EMAIL_SENT: 'Password reset email sent. Please check your inbox.',
  PASSWORD_CHANGED: 'Password changed successfully',
  EMAIL_VERIFICATION_SENT: 'Verification email sent. Please check your inbox.',
  EMAIL_VERIFIED: 'Email verified successfully',
  USER_ONBOARDED: 'User onboarded successfully',
  PROFILE_COMPLETED: 'Profile completed successfully',
  PROFILE_UPDATED: 'Profile updated successfully',
  DOCUMENTS_SUBMITTED: 'Documents submitted for review',
  DOCUMENT_UPLOADED: 'Document uploaded successfully',
  DOCUMENT_DELETED: 'Document deleted successfully',
  APPLICATION_SUBMITTED: 'Application submitted successfully',
  APPLICATION_ACCEPTED: 'Application accepted successfully',
  APPLICATION_REJECTED: 'Application rejected',
  SERVICE_REQUEST_CREATED: 'Service request created successfully',
  SERVICE_REQUEST_UPDATED: 'Service request updated successfully',
  SERVICE_REQUEST_CANCELLED: 'Service request cancelled',
  HANDYMAN_APPROVED: 'Handyman approved successfully',
  HANDYMAN_REJECTED: 'Handyman rejected',
  CATEGORY_CREATED: 'Category created successfully',
  CATEGORY_UPDATED: 'Category updated successfully',
  CATEGORY_DELETED: 'Category deactivated successfully',
} as const;

export const REGEX_PATTERNS = {
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  PHONE: /^\+?[1-9]\d{1,14}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
} as const;

/**
 * Internal application events for pub/sub communication between modules.
 * Uses dot notation for namespacing (e.g., 'user.created').
 * Wildcard listeners can subscribe to 'user.*' to receive all user events.
 */
export const EVENTS = {
  // User events
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_EMAIL_VERIFIED: 'user.email.verified',

  // Auth events
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password.reset.requested',
  AUTH_PASSWORD_RESET_COMPLETED: 'auth.password.reset.completed',
  AUTH_PASSWORD_CHANGED: 'auth.password.changed',

  // Notification events
  NOTIFICATION_SEND: 'notification.send',
  NOTIFICATION_EMAIL: 'notification.email',
  NOTIFICATION_PUSH: 'notification.push',
  NOTIFICATION_SMS: 'notification.sms',

  // Onboarding events
  USER_ONBOARDED: 'user.onboarded',

  // Waitlist events
  WAITLIST_JOINED: 'waitlist.joined',

  // Handyman events
  HANDYMAN_PROFILE_COMPLETED: 'handyman.profile.completed',
  HANDYMAN_DOCUMENTS_SUBMITTED: 'handyman.documents.submitted',
  HANDYMAN_VERIFIED: 'handyman.verified',
  HANDYMAN_REJECTED: 'handyman.rejected',

  // Service request events
  SERVICE_REQUEST_CREATED: 'service-request.created',
  SERVICE_REQUEST_APPLICATION_RECEIVED: 'service-request.application.received',
  SERVICE_REQUEST_ASSIGNED: 'service-request.assigned',
  SERVICE_REQUEST_COMPLETED: 'service-request.completed',
  SERVICE_REQUEST_CANCELLED: 'service-request.cancelled',
} as const;
