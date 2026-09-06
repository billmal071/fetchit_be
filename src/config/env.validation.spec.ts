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
