import { z } from 'zod';

const baseEnvSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('v1'),

  // Frontend web app (the URL users open in a browser, NOT the API host).
  // Required and validated so the app fails fast instead of silently falling
  // back to http://localhost:4200 — email verification links and OAuth
  // callback/redirect URLs are built from this value.
  FRONTEND_URL: z.string().url({
    message:
      'FRONTEND_URL must be a valid URL pointing at the frontend web app (e.g. https://app.example.com)',
  }),

  // Database
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid PostgreSQL URL' }),

  // JWT
  JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  JWT_EXPIRES_IN: z.string().default('15m'),
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
    .default('false'),
  SWAGGER_TITLE: z.string().default('FetchIt API'),
  SWAGGER_DESCRIPTION: z.string().default('FetchIt Backend API Documentation'),
  SWAGGER_VERSION: z.string().default('1.0'),

  // Storage (pluggable object storage: 'local' or 's3-compatible').
  // Every entry is optional with a safe default so an existing deployment that
  // sets none of them still boots on the filesystem driver.
  STORAGE_DRIVER: z.enum(['local', 's3-compatible']).default('local'),
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
  STORAGE_MAX_FILE_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  STORAGE_LOCAL_ROOT: z.string().default('./storage/uploads'),
  // The STORAGE_S3_* variables configure the *S3 wire protocol*, not AWS. "S3"
  // is what Cloudflare, Backblaze and Supabase each call this API in their own
  // documentation, which is why the prefix keeps that name. These settings work
  // against Cloudflare R2 (our target), Backblaze B2, Supabase Storage and
  // MinIO just as they do against AWS S3, and cost nothing on R2's free tier:
  // https://developers.cloudflare.com/r2/pricing/
  //
  // STORAGE_S3_ENDPOINT is required by every provider except AWS S3 itself,
  // which derives its endpoint from the region. For Cloudflare R2 it is
  // https://<account-id>.r2.cloudflarestorage.com
  STORAGE_S3_ENDPOINT: z.string().url().optional(),
  STORAGE_S3_REGION: z.string().default('auto'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
});

/**
 * Opting into the s3-compatible driver without the settings it needs would fail
 * on the first upload, long after boot. Fail fast instead — but only when the
 * driver was explicitly selected, so the default `local` path stays
 * credential-free.
 */
export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER !== 's3-compatible') return;

  const required = [
    'STORAGE_S3_BUCKET',
    'STORAGE_S3_ACCESS_KEY_ID',
    'STORAGE_S3_SECRET_ACCESS_KEY',
  ] as const;

  for (const key of required) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when STORAGE_DRIVER is 's3-compatible'`,
      });
    }
  }
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
