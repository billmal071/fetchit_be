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
} as const;

export const REGEX_PATTERNS = {
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  PHONE: /^\+?[1-9]\d{1,14}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
} as const;
