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
