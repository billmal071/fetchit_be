import { z } from 'zod';

export const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('v1'),
  FRONTEND_URL: z.string().default('http://localhost:4200'),

  // Database
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid PostgreSQL URL' }),

  // JWT
  JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  JWT_EXPIRES_IN: z.string().default('1d'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' }),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Rate Limiting
  THROTTLE_TTL: z.coerce.number().default(60),
  THROTTLE_LIMIT: z.coerce.number().default(100),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Swagger
  SWAGGER_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),
  SWAGGER_TITLE: z.string().default('FetchIt API'),
  SWAGGER_DESCRIPTION: z.string().default('FetchIt Backend API Documentation'),
  SWAGGER_VERSION: z.string().default('1.0'),

  // Google OAuth (optional)
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_CALLBACK_URL: z
    .string()
    .optional()
    .default('http://localhost:3000/api/v1/auth/google/callback'),

  // SMTP (optional)
  SMTP_HOST: z.string().optional().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_SECURE: z
    .string()
    .transform((val) => val === 'true')
    .optional()
    .default('false'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('noreply@fetchit.com'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.errors.map((error) => {
      return `${error.path.join('.')}: ${error.message}`;
    });

    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  return result.data;
}
