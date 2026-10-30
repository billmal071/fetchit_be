import configuration from './configuration';
import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/fetchit?schema=public',
  FRONTEND_URL: 'http://localhost:4200',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('storage environment configuration', () => {
  it('boots with no STORAGE_* variables at all', () => {
    // The deployed .env predates this feature; adding it must not break boot.
    const config = validateEnv({ ...baseEnv });

    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.STORAGE_LOCAL_ROOT).toBe('./storage/uploads');
    expect(config.STORAGE_MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
    expect(config.STORAGE_S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('accepts a fully configured S3-compatible driver (Cloudflare R2)', () => {
    const config = validateEnv({
      ...baseEnv,
      STORAGE_DRIVER: 's3-compatible',
      STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      STORAGE_S3_BUCKET: 'fetchit-documents',
      STORAGE_S3_ACCESS_KEY_ID: 'key',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
      STORAGE_S3_FORCE_PATH_STYLE: 'false',
      STORAGE_MAX_FILE_SIZE: '1048576',
    });

    expect(config.STORAGE_DRIVER).toBe('s3-compatible');
    expect(config.STORAGE_S3_FORCE_PATH_STYLE).toBe(false);
    expect(config.STORAGE_MAX_FILE_SIZE).toBe(1048576);
  });

  it('fails fast when the s3-compatible driver is selected without credentials', () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 's3-compatible' })).toThrow(
      /STORAGE_S3_BUCKET is required when STORAGE_DRIVER is 's3-compatible'/,
    );
  });

  it('accepts a fully configured Cloudinary driver', () => {
    const config = validateEnv({
      ...baseEnv,
      STORAGE_DRIVER: 'cloudinary',
      STORAGE_CLOUDINARY_CLOUD_NAME: 'fetchit',
      STORAGE_CLOUDINARY_API_KEY: 'key',
      STORAGE_CLOUDINARY_API_SECRET: 'secret',
    });

    expect(config.STORAGE_DRIVER).toBe('cloudinary');
  });

  it('fails fast when the cloudinary driver is selected without credentials', () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 'cloudinary' })).toThrow(
      /STORAGE_CLOUDINARY_CLOUD_NAME is required when STORAGE_DRIVER is 'cloudinary'/,
    );
  });

  it('does not demand S3 credentials from the cloudinary driver', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        STORAGE_DRIVER: 'cloudinary',
        STORAGE_CLOUDINARY_CLOUD_NAME: 'fetchit',
        STORAGE_CLOUDINARY_API_KEY: 'key',
        STORAGE_CLOUDINARY_API_SECRET: 'secret',
      }),
    ).not.toThrow();
  });

  it("rejects the old bare 's3' value so a stale .env fails loudly", () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 's3' })).toThrow(
      /Environment validation failed/,
    );
  });

  it('rejects an unknown driver', () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 'gcs' })).toThrow(
      /Environment validation failed/,
    );
  });
});

describe('API_VERSION', () => {
  it('defaults to a bare number, so routes mount at /api/v1', () => {
    // Nest URI versioning prepends "v" to this value. The default used to be
    // 'v1', which served every route at /api/vv1.
    expect(validateEnv({ ...baseEnv }).API_VERSION).toBe('1');
  });

  it('rejects a "v"-prefixed value rather than serving /api/vv1', () => {
    expect(() => validateEnv({ ...baseEnv, API_VERSION: 'v1' })).toThrow(/must not start with "v"/);
    expect(() => validateEnv({ ...baseEnv, API_VERSION: 'V2' })).toThrow(/must not start with "v"/);
  });

  it('accepts a bare version number', () => {
    expect(validateEnv({ ...baseEnv, API_VERSION: '2' }).API_VERSION).toBe('2');
  });
});

describe('variables read by configuration()', () => {
  /**
   * Nest assigns only the validated object back to process.env, and zod strips
   * unknown keys — so anything missing here is silently dropped when it is set
   * via .env rather than as a real environment variable. These nine were the
   * ones that went missing; the app crashed at boot inside the Resend client.
   */
  const optionalPassthrough = [
    'REDIS_URL',
    'REDIS_TLS',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'RESEND_FROM_EMAIL',
    'RESEND_FROM_NAME',
  ] as const;

  it.each(optionalPassthrough)('keeps %s instead of stripping it', (key) => {
    const config = validateEnv({ ...baseEnv, [key]: 'configured-value' }) as Record<
      string,
      unknown
    >;

    expect(config[key]).toBe('configured-value');
  });

  it('still boots when none of them are set', () => {
    expect(() => validateEnv({ ...baseEnv })).not.toThrow();
  });
});

describe('Neon Object Storage driver', () => {
  const neonEnv = {
    STORAGE_DRIVER: 'neon',
    STORAGE_NEON_BUCKET: 'fetchit-uploads',
    AWS_ENDPOINT_URL_S3: 'https://br-example-123.storage.us-east-2.aws.neon.tech',
    AWS_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'key',
    AWS_SECRET_ACCESS_KEY: 'secret',
  };

  it('accepts a fully configured neon driver', () => {
    const config = validateEnv({ ...baseEnv, ...neonEnv });

    expect(config.STORAGE_DRIVER).toBe('neon');
    expect(config.STORAGE_NEON_BUCKET).toBe('fetchit-uploads');
    expect(config.AWS_REGION).toBe('us-east-2');
  });

  /**
   * The whole point of declaring the AWS_* names in the schema. Nest assigns
   * only the validated object back to process.env and zod strips unknown
   * keys, so an undeclared AWS_ACCESS_KEY_ID set via .env would vanish before
   * configuration() ever read it — and the driver would then construct an
   * S3 client with empty credentials and fail on the first upload rather than
   * at boot.
   */
  it.each([
    'AWS_ENDPOINT_URL_S3',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'STORAGE_NEON_BUCKET',
  ] as const)('keeps %s instead of stripping it', (key) => {
    const config = validateEnv({ ...baseEnv, ...neonEnv }) as Record<string, unknown>;

    expect(config[key]).toBe(neonEnv[key]);
  });

  it.each([
    'STORAGE_NEON_BUCKET',
    'AWS_ENDPOINT_URL_S3',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const)('fails fast when %s is missing', (missing) => {
    const partial: Record<string, unknown> = { ...baseEnv, ...neonEnv };
    delete partial[missing];

    expect(() => validateEnv(partial)).toThrow(
      new RegExp(`${missing} is required when STORAGE_DRIVER is 'neon'`),
    );
  });

  it.each([
    'STORAGE_NEON_BUCKET',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const)('rejects an empty %s', (key) => {
    expect(() => validateEnv({ ...baseEnv, ...neonEnv, [key]: '' })).toThrow(
      new RegExp(`${key} is required when STORAGE_DRIVER is 'neon'`),
    );
  });

  it.each([
    'STORAGE_NEON_BUCKET',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const)('rejects a whitespace-only %s', (key) => {
    // Truthy, so an untrimmed check would accept it and hand " " to the S3
    // client — a boot-time misconfiguration turned into request-time failures.
    expect(() => validateEnv({ ...baseEnv, ...neonEnv, [key]: '   ' })).toThrow(
      new RegExp(`${key} is required when STORAGE_DRIVER is 'neon'`),
    );
  });

  it('does not demand S3 or Cloudinary credentials from the neon driver', () => {
    expect(() => validateEnv({ ...baseEnv, ...neonEnv })).not.toThrow();
  });

  it('leaves the AWS_* names unset when another driver is selected', () => {
    // They are optional, so an existing deployment on any other driver keeps
    // booting without them.
    const config = validateEnv({ ...baseEnv }) as Record<string, unknown>;

    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.AWS_ACCESS_KEY_ID).toBeUndefined();
  });

  it('rejects a non-URL endpoint rather than failing at the first request', () => {
    expect(() => validateEnv({ ...baseEnv, ...neonEnv, AWS_ENDPOINT_URL_S3: 'not-a-url' })).toThrow(
      /Environment validation failed/,
    );
  });
});

describe('Neon public bucket', () => {
  const neonEnv = {
    STORAGE_DRIVER: 'neon',
    STORAGE_NEON_BUCKET: 'fetchit-uploads',
    AWS_ENDPOINT_URL_S3: 'https://br-example-123.storage.us-east-2.aws.neon.tech',
    AWS_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'key',
    AWS_SECRET_ACCESS_KEY: 'secret',
  };

  it('defaults the public prefixes to avatars and receipts', () => {
    expect(validateEnv({ ...baseEnv, ...neonEnv }).STORAGE_NEON_PUBLIC_PREFIXES).toBe(
      'avatars,receipts',
    );
  });

  // Same strip trap as the AWS_* names: undeclared keys never reach
  // configuration(), so the bucket would silently read as undefined and every
  // avatar would land in the private bucket.
  it('keeps STORAGE_NEON_PUBLIC_BUCKET instead of stripping it', () => {
    const config = validateEnv({
      ...baseEnv,
      ...neonEnv,
      STORAGE_NEON_PUBLIC_BUCKET: 'fetchit-public',
    });

    expect(config.STORAGE_NEON_PUBLIC_BUCKET).toBe('fetchit-public');
  });

  it('keeps a narrowed STORAGE_NEON_PUBLIC_PREFIXES', () => {
    const config = validateEnv({
      ...baseEnv,
      ...neonEnv,
      STORAGE_NEON_PUBLIC_PREFIXES: 'avatars',
    });

    expect(config.STORAGE_NEON_PUBLIC_PREFIXES).toBe('avatars');
  });

  it('boots without a public bucket, since it is optional', () => {
    const config = validateEnv({ ...baseEnv, ...neonEnv });

    expect(config.STORAGE_NEON_PUBLIC_BUCKET).toBeUndefined();
  });
});

describe('STORAGE_NEON_PUBLIC_PREFIXES guards', () => {
  const neonEnv = {
    STORAGE_DRIVER: 'neon',
    STORAGE_NEON_BUCKET: 'fetchit-uploads',
    STORAGE_NEON_PUBLIC_BUCKET: 'fetchit-public',
    AWS_ENDPOINT_URL_S3: 'https://br-example-123.storage.us-east-2.aws.neon.tech',
    AWS_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'key',
    AWS_SECRET_ACCESS_KEY: 'secret',
  };

  /**
   * The private/public boundary, enforced rather than documented. Listing this
   * prefix would write handyman KYC documents into the public_read bucket,
   * readable by anyone holding the URL — the outcome the split exists to stop.
   */
  it.each([
    'handyman-documents',
    'avatars,handyman-documents',
    'avatars, handyman-documents ,receipts',
  ])('refuses to boot when the list contains handyman-documents (%s)', (prefixes) => {
    expect(() =>
      validateEnv({ ...baseEnv, ...neonEnv, STORAGE_NEON_PUBLIC_PREFIXES: prefixes }),
    ).toThrow(/must never be listed here/);
  });

  it('rejects handyman-documents even on another driver', () => {
    // The guard runs before the driver-specific checks, so a prefix list that
    // would leak documents cannot sit unnoticed in a local/cloudinary .env
    // waiting to take effect the moment the driver is switched.
    expect(() =>
      validateEnv({
        ...baseEnv,
        STORAGE_DRIVER: 'local',
        STORAGE_NEON_PUBLIC_PREFIXES: 'handyman-documents',
      }),
    ).toThrow(/must never be listed here/);
  });

  it.each(['avatars/', 'avatars/u1', 'avatars,receipts/'])(
    'rejects an entry containing a slash (%s)',
    (prefixes) => {
      // bucketFor() matches the key's first path segment, so 'avatars/' never
      // matches and avatars would silently land in the private bucket.
      expect(() =>
        validateEnv({ ...baseEnv, ...neonEnv, STORAGE_NEON_PUBLIC_PREFIXES: prefixes }),
      ).toThrow(/single path segments/);
    },
  );

  it('rejects an empty list when a public bucket is set', () => {
    expect(() =>
      validateEnv({ ...baseEnv, ...neonEnv, STORAGE_NEON_PUBLIC_PREFIXES: '  ,  ' }),
    ).toThrow(/must list at least one prefix/);
  });

  it('allows an empty list when no public bucket is set', () => {
    const withoutPublicBucket: Record<string, string> = { ...neonEnv };
    delete withoutPublicBucket.STORAGE_NEON_PUBLIC_BUCKET;

    expect(() =>
      validateEnv({ ...baseEnv, ...withoutPublicBucket, STORAGE_NEON_PUBLIC_PREFIXES: '' }),
    ).not.toThrow();
  });

  it('allows an empty list when the public bucket is blank', () => {
    // A blank bucket is read as unset by configuration(), so the guard must
    // agree rather than reporting a bucket the app would never use.
    expect(() =>
      validateEnv({
        ...baseEnv,
        ...neonEnv,
        STORAGE_NEON_PUBLIC_BUCKET: '   ',
        STORAGE_NEON_PUBLIC_PREFIXES: '',
      }),
    ).not.toThrow();
  });

  it('accepts a narrowed single-segment list', () => {
    expect(() =>
      validateEnv({ ...baseEnv, ...neonEnv, STORAGE_NEON_PUBLIC_PREFIXES: 'avatars' }),
    ).not.toThrow();
  });
});

describe('configuration() storage.neon mapping', () => {
  // validateEnv proves the value survives validation; this proves it actually
  // reaches the provider options. Nothing covered the env-to-provider hop.
  // `process.env` coerces every assigned value to a string, so assigning
  // `undefined` stores the literal 'undefined' rather than unsetting the
  // variable — which is not what a test asserting DEFAULTS means. Keys with no
  // value are deleted instead, and the restore mutates the real `process.env`
  // rather than replacing it with a plain object (replacing it would drop the
  // coercion for every later test in the file).
  const withEnv = <T>(vars: Record<string, string | undefined>, run: () => T): T => {
    const saved = { ...process.env };
    for (const [name, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    try {
      return run();
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in saved)) delete process.env[name];
      }
      Object.assign(process.env, saved);
    }
  };

  it('maps a narrowed STORAGE_NEON_PUBLIC_PREFIXES to publicKeyPrefixes', () => {
    const storage = withEnv(
      {
        STORAGE_NEON_PUBLIC_BUCKET: 'fetchit-public',
        STORAGE_NEON_PUBLIC_PREFIXES: 'avatars',
      },
      () => configuration().storage,
    );

    expect(storage.neon.publicBucket).toBe('fetchit-public');
    expect(storage.neon.publicKeyPrefixes).toEqual(['avatars']);
  });

  it('trims entries and drops empty ones', () => {
    const storage = withEnv(
      { STORAGE_NEON_PUBLIC_PREFIXES: ' avatars , , receipts ' },
      () => configuration().storage,
    );

    expect(storage.neon.publicKeyPrefixes).toEqual(['avatars', 'receipts']);
  });

  it('reads a blank STORAGE_NEON_PUBLIC_BUCKET as unset', () => {
    // '   ' is truthy, so an untrimmed read would hand `bucketFor()` a bucket
    // named '   ' and every avatar PutObject would go out with a blank Bucket.
    const storage = withEnv({ STORAGE_NEON_PUBLIC_BUCKET: '   ' }, () => configuration().storage);

    expect(storage.neon.publicBucket).toBeUndefined();
  });

  it('defaults to avatars and receipts, and leaves publicBucket undefined', () => {
    const storage = withEnv(
      { STORAGE_NEON_PUBLIC_PREFIXES: undefined, STORAGE_NEON_PUBLIC_BUCKET: undefined },
      () => configuration().storage,
    );

    expect(storage.neon.publicKeyPrefixes).toEqual(['avatars', 'receipts']);
    expect(storage.neon.publicBucket).toBeUndefined();
  });
});
