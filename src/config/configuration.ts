import type { IStorageConfig } from '@/storage/interfaces';

export interface IAppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  frontendUrl: string;
}

export interface IJwtConfig {
  secret: string | undefined;
  expiresIn: string;
  refreshSecret: string | undefined;
  refreshExpiresIn: string;
}

export interface IRedisConfig {
  host: string;
  port: number;
  password: string;
  url?: string;
  tls?: boolean;
}

export interface IThrottleConfig {
  ttl: number;
  limit: number;
}

export interface ISwaggerConfig {
  enabled: boolean;
  title: string;
  description: string;
  version: string;
}

export interface IGoogleConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface IResendConfig {
  apiKey: string;
  from: string;
  fromEmail: string;
  fromName: string;
}

export interface IConfiguration {
  app: IAppConfig;
  jwt: IJwtConfig;
  redis: IRedisConfig;
  throttle: IThrottleConfig;
  cors: { origins: string[] };
  swagger: ISwaggerConfig;
  google: IGoogleConfig;
  resend: IResendConfig;
  storage: IStorageConfig;
}

export default (): IConfiguration => ({
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api',
    // No "v" prefix: Nest URI versioning adds one, so 'v1' here serves /api/vv1.
    apiVersion: process.env.API_VERSION || '1',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
    url: process.env.REDIS_URL || '',
    tls: process.env.REDIS_TLS === 'true',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    title: process.env.SWAGGER_TITLE || 'FetchIt API',
    description: process.env.SWAGGER_DESCRIPTION || 'FetchIt Backend API Documentation',
    version: process.env.SWAGGER_VERSION || '1.0',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || '',
    fromName: process.env.RESEND_FROM_NAME || '',
  },
  storage: {
    driver: process.env.STORAGE_DRIVER === 's3-compatible' ? 's3-compatible' : 'local',
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL || undefined,
    maxFileSize: parseInt(process.env.STORAGE_MAX_FILE_SIZE || '5242880', 10),
    local: {
      root: process.env.STORAGE_LOCAL_ROOT || './storage/uploads',
    },
    s3: {
      endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
      region: process.env.STORAGE_S3_REGION || 'auto',
      bucket: process.env.STORAGE_S3_BUCKET || '',
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY || '',
      forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE !== 'false',
    },
  },
});
