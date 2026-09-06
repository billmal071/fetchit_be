export interface IApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: IMeta;
  timestamp: string;
}

export interface IMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IErrorResponse {
  success: boolean;
  message: string;
  error: string;
  statusCode: number;
  code?: string;
  timestamp: string;
  path: string;
  details?: IValidationError[] | Record<string, unknown>;
}

export interface IValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface IJwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface ITokens {
  accessToken: string;
  refreshToken: string;
}

export interface IRequestUser {
  id: string;
  email: string;
  role: string;
}

export interface IPaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface IPaginatedResult<T> {
  data: T[];
  meta: IMeta;
}

// Event Payload Interfaces
export interface IUserEventPayload {
  userId: string;
  email: string;
  timestamp: Date;
}

export interface IAuthLoginPayload extends IUserEventPayload {
  ipAddress?: string;
  userAgent?: string;
}

export interface IAuthLogoutPayload {
  userId: string;
  timestamp: Date;
}

export interface IPasswordResetRequestedPayload {
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
  timestamp: Date;
}

export interface IPasswordResetCompletedPayload {
  userId: string;
  email: string;
  timestamp: Date;
}

export interface INotificationPayload {
  userId: string;
  type: 'email' | 'push' | 'sms';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface IWaitlistJoinedPayload {
  email: string;
  role: string;
  timestamp: Date;
}

export interface IEmailPayload {
  to: string | string[];
  subject: string;
  html: string;
}

export interface IEmailProvider {
  sendEmail(payload: IEmailPayload): Promise<void>;
}

/**
 * The subset of a multipart file the application actually uses.
 *
 * Deliberately narrower than `Express.Multer.File`: `originalname` and
 * `mimetype` are client-controlled and only ever used as a display label or
 * ignored outright, so nothing downstream should be tempted to trust them.
 */
export interface IUploadedFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}
