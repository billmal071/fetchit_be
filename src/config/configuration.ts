// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { EnvConfig } from './env.validation';

export interface IAppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  frontendUrl: string;
}

export interface IJwtConfig {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

export interface IRedisConfig {
  host: string;
  port: number;
  password: string;
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

export interface ISmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface IConfiguration {
  app: IAppConfig;
  jwt: IJwtConfig;
  redis: IRedisConfig;
  throttle: IThrottleConfig;
  cors: { origins: string[] };
  swagger: ISwaggerConfig;
  google: IGoogleConfig;
  smtp: ISmtpConfig;
}

export default (): IConfiguration => ({
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api',
    apiVersion: process.env.API_VERSION || 'v1',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
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
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback',
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'noreply@fetchit.com',
  },
});
