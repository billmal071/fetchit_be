import { z } from 'zod';

/**
 * EVERY environment variable the app reads must be declared here, even the
 * optional ones with empty defaults.
 *
 * `ConfigModule` is wired with `validate: validateEnv`, and Nest assigns only
 * the *validated* object back to `process.env`. Zod strips keys it does not
 * know about, so a variable that is missing from this schema and set only in
 * `.env` never reaches `process.env` at all — `configuration()` then reads
 * `undefined` and silently falls back to its default.
 *
 * That is not hypothetical: the four RESEND_ and three GOOGLE_ values, plus
 * REDIS_URL and REDIS_TLS, were all absent, and the app crashed at boot inside
 * the Resend client for anyone who configured it through `.env` rather than
 * through real environment variables. It worked on the servers only because
 * those set them as actual env vars, which Nest never overwrites.
 *
 * If you add a `process.env.X` read anywhere, add X here in the same commit.
 */
const baseEnvSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('api'),
  // Bare version number, WITHOUT a leading "v". Nest's URI versioning prepends
  // its own "v", so API_VERSION=v1 mounts every route at /api/vv1 and each
  // /api/v1 request 404s. Rejected explicitly below rather than left to be
  // discovered against a running server.
  API_VERSION: z
    .string()
    .default('1')
    .refine((value) => !/^v/i.test(value), {
      message:
        'API_VERSION must not start with "v" — Nest URI versioning adds that prefix itself, ' +
        'so "v1" would serve routes at /api/vv1. Use "1".',
    }),

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
  REDIS_URL: z.string().optional().default(''),
  REDIS_TLS: z.string().optional().default('false'),

  // Google OAuth. Optional: the app boots without it, and only the Google
  // sign-in route is unavailable.
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_CALLBACK_URL: z.string().optional().default(''),

  // Email (Resend). Optional: without a key the provider logs what it would
  // have sent instead of sending it.
  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_FROM: z.string().optional().default(''),
  RESEND_FROM_EMAIL: z.string().optional().default(''),
  RESEND_FROM_NAME: z.string().optional().default(''),

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
  STORAGE_DRIVER: z.enum(['local', 's3-compatible', 'cloudinary', 'neon']).default('local'),
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
  // Cloudinary is not S3-compatible, so it takes its own credentials rather
  // than the STORAGE_S3_* set. All three come from the account's dashboard.
  STORAGE_CLOUDINARY_CLOUD_NAME: z.string().optional(),
  STORAGE_CLOUDINARY_API_KEY: z.string().optional(),
  STORAGE_CLOUDINARY_API_SECRET: z.string().optional(),

  // Neon Object Storage. S3-compatible (path-style + SigV4 only), so it runs
  // on the same provider class as 's3-compatible' — but its credentials are
  // injected under AWS-STANDARD names, not STORAGE_S3_*, because that is what
  // Neon writes: `neon env pull` / `neon deploy` / `neon checkout` populate
  // AWS_* in .env.local, and a deployed Neon Function gets them for free.
  //
  // They are declared here rather than mapped into STORAGE_S3_* on purpose.
  // Neon credentials are BRANCH-scoped, so every branch switch rewrites AWS_*;
  // a hand-copied STORAGE_S3_* pair would keep pointing at the old branch with
  // nothing to indicate it had gone stale.
  //
  // Bucket is ours, not Neon's: it is declared in neon.ts and created by
  // `neon deploy`, so Neon has no env var for it.
  AWS_ENDPOINT_URL_S3: z.string().url().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_NEON_BUCKET: z.string().optional(),
  // Second, public_read bucket for objects whose URL a client persists and
  // re-reads later: avatars and receipts. `getUrl()` is synchronous and
  // unsigned, so against the private bucket its address is refused, and
  // signing instead would return a URL that expires while still stored.
  //
  // Optional: leave it unset and everything uses STORAGE_NEON_BUCKET, which
  // is the behaviour before this existed. Identity documents never go here —
  // they stay in the private bucket and are signed on every read.
  STORAGE_NEON_PUBLIC_BUCKET: z.string().optional(),
  // Comma-separated first path segments routed to the public bucket. Narrow
  // it (e.g. just 'avatars') to keep receipts private; anything removed from
  // here needs a read path that signs, or its URLs stop resolving.
  STORAGE_NEON_PUBLIC_PREFIXES: z.string().default('avatars,receipts'),
});

/**
 * First path segment of handyman KYC document keys, generated in
 * `handyman.service.ts`. Named here because the public-bucket guard below has
 * to reject it: it is the one prefix that must never become publicly readable.
 */
export const HANDYMAN_DOCUMENT_PREFIX = 'handyman-documents';

/** Credentials each non-default driver cannot run without. */
const REQUIRED_BY_DRIVER = {
  's3-compatible': [
    'STORAGE_S3_BUCKET',
    'STORAGE_S3_ACCESS_KEY_ID',
    'STORAGE_S3_SECRET_ACCESS_KEY',
  ],
  cloudinary: [
    'STORAGE_CLOUDINARY_CLOUD_NAME',
    'STORAGE_CLOUDINARY_API_KEY',
    'STORAGE_CLOUDINARY_API_SECRET',
  ],
  // AWS_REGION is required rather than defaulted: SigV4 signs with the region,
  // so a wrong one fails authentication at the first request instead of
  // falling back to anything sensible. Neon injects it, so there is nothing to
  // guess.
  neon: [
    'AWS_ENDPOINT_URL_S3',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'STORAGE_NEON_BUCKET',
  ],
} as const satisfies Record<string, readonly (keyof z.infer<typeof baseEnvSchema>)[]>;

/**
 * Opting into a cloud driver without the settings it needs would fail on the
 * first upload, long after boot. Fail fast instead — but only when the driver
 * was explicitly selected, so the default `local` path stays credential-free.
 */
export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  // Checked before the early return below, so a misrouted prefix is caught
  // whatever STORAGE_DRIVER is set to.
  const publicPrefixes = env.STORAGE_NEON_PUBLIC_PREFIXES.split(',')
    .map((prefix) => prefix.trim())
    .filter(Boolean);

  // `bucketFor()` compares the key's first path segment, so an entry written
  // as 'avatars/' never matches anything: avatars would silently land in the
  // private bucket and their URLs would be refused.
  const withSlash = publicPrefixes.filter((prefix) => prefix.includes('/'));
  if (withSlash.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_NEON_PUBLIC_PREFIXES'],
      message:
        `entries must be single path segments without "/" — got ${withSlash.join(', ')}. ` +
        'Routing matches the first path segment of a key, so a trailing slash never matches.',
    });
  }

  // The private/public boundary enforced in code rather than left to the
  // warning in .env.example. Listing this prefix would write handyman KYC
  // documents into the public_read bucket, where anyone holding the URL can
  // read them — the exact outcome the two-bucket split exists to prevent.
  if (publicPrefixes.includes(HANDYMAN_DOCUMENT_PREFIX)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_NEON_PUBLIC_PREFIXES'],
      message:
        `'${HANDYMAN_DOCUMENT_PREFIX}' must never be listed here: identity documents have to ` +
        'stay in the private bucket, where every read is signed and expires.',
    });
  }

  // A public bucket nothing routes to is a dead setting: every object goes to
  // the private bucket, so the URL POST /uploads returns is refused.
  // STORAGE_PUBLIC_BASE_URL does not rescue it — that only rewrites the
  // address, it does not move the object.
  // Trimmed to match configuration.ts, which reads a blank value as unset.
  // The two must agree: if this guard treated '   ' as a configured bucket
  // while configuration() dropped it, the error would name a bucket the app
  // was never going to use.
  const publicBucket = env.STORAGE_NEON_PUBLIC_BUCKET?.trim();

  // The split is two BUCKETS, not two prefixes inside one. Pointing both names
  // at the same bucket makes `bucketFor()` return it for every key, so the
  // separation silently collapses: if that bucket is public_read, every KYC
  // document under `handyman-documents/` becomes readable by anyone holding
  // its URL. Leave STORAGE_NEON_PUBLIC_BUCKET unset for single-bucket mode —
  // that is the fail-safe direction, since everything then stays private.
  if (publicBucket && publicBucket === env.STORAGE_NEON_BUCKET?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_NEON_PUBLIC_BUCKET'],
      message:
        `must not be the same bucket as STORAGE_NEON_BUCKET ('${publicBucket}'). The public/private ` +
        'split needs two separate buckets; one bucket serving both would publish identity documents ' +
        'if it is public_read. Unset this to use the single private bucket instead.',
    });
  }

  if (publicBucket && publicPrefixes.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_NEON_PUBLIC_PREFIXES'],
      message:
        'must list at least one prefix when STORAGE_NEON_PUBLIC_BUCKET is set, otherwise no key ' +
        'routes to that bucket and avatar/receipt URLs are refused.',
    });
  }

  const required = REQUIRED_BY_DRIVER[env.STORAGE_DRIVER as keyof typeof REQUIRED_BY_DRIVER];
  if (!required) return;

  for (const key of required) {
    // Trimmed: a whitespace-only value is truthy, so `!env[key]` would accept
    // it and hand " " to the S3/Cloudinary client, turning a boot-time
    // misconfiguration into request-time auth failures.
    if (!String(env[key] ?? '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when STORAGE_DRIVER is '${env.STORAGE_DRIVER}'`,
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
