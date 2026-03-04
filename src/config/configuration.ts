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
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
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
});
