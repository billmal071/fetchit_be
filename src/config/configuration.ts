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
  /** Connection URL (e.g., rediss://default:password@host:port) - preferred for Upstash */
  url?: string;
  host: string;
  port: number;
  password: string;
  /** Enable TLS connection */
  tls: boolean;
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
}

export interface ICacheConfig {
  type: 'memory' | 'redis';
  defaultTtl: number;
  redis?: {
    keyPrefix: string;
  };
  memory?: {
    max: number;
  };
}

export interface IConfiguration {
  app: IAppConfig;
  jwt: IJwtConfig;
  redis: IRedisConfig;
  cache: ICacheConfig;
  throttle: IThrottleConfig;
  cors: { origins: string[] };
  swagger: ISwaggerConfig;
  google: IGoogleConfig;
  resend: IResendConfig;
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
    url: process.env.REDIS_URL || undefined,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
    tls: process.env.REDIS_TLS === 'true',
  },
  cache: {
    type: (process.env.CACHE_TYPE as 'memory' | 'redis') || 'memory',
    defaultTtl: parseInt(process.env.CACHE_DEFAULT_TTL || '300', 10),
    redis: {
      keyPrefix: process.env.CACHE_KEY_PREFIX || 'fetchit:cache:',
    },
    memory: {
      max: parseInt(process.env.CACHE_MAX_ITEMS || '1000', 10),
    },
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
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM || 'noreply@fetchit.com',
  },
});
