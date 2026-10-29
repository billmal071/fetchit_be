/**
 * Storage Provider Interface
 *
 * Abstracts object storage so business logic never depends on a specific
 * vendor. The `s3-compatible` driver speaks the S3 wire protocol, which
 * Cloudflare R2, Backblaze B2, Supabase Storage, MinIO and AWS S3 all
 * implement — switching between them is an environment change, not a code
 * change. The `cloudinary` driver covers Cloudinary, which has its own API
 * rather than an S3-compatible one.
 */
export interface IStorageProvider {
  /**
   * Store an object.
   *
   * @param input - the object to store; `key` is server-generated and must
   *   never contain client-controlled path segments.
   * @returns metadata for the stored object, including a resolvable URL.
   */
  upload(input: IStorageUploadInput): Promise<IStoredObject>;

  /**
   * Remove a stored object. Deleting a missing key is a no-op.
   */
  delete(key: string): Promise<void>;

  /**
   * Public (or base-URL-derived) address for a stored key.
   *
   * Historically also what `HandymanDocument.fileKey` and friends stored
   * (bug #17: a permanent URL in the database — often a genuinely public one
   * for the s3-compatible and local drivers, since neither signs it). Nothing
   * should persist this for anything access-sensitive any more; it exists for
   * drivers/callers that are fine with a stable, unauthenticated address.
   */
  getUrl(key: string): string;

  /**
   * Short-lived address for a stored key, for anything sensitive (KYC
   * documents): a caller who has this URL can fetch the object only until
   * `expiresInSeconds` elapses, so leaking one (a log line, a browser
   * history entry, a cached response) is not a permanent compromise the way
   * a stored `getUrl()` address is.
   *
   * Only honoured by `s3-compatible`. `local` and `cloudinary` return a
   * non-expiring address instead (see their class comments for why) —
   * `StorageModule` logs a warning on boot when either is selected.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  /**
   * Provider name for logging/health output.
   */
  getProviderName(): string;
}

export interface IStorageUploadInput {
  /** Server-generated object key, e.g. `handyman-documents/<id>/<uuid>.pdf`. */
  key: string;
  /** File contents. */
  body: Buffer;
  /** Content type, derived from sniffing the bytes — never from the client. */
  contentType: string;
}

export interface IStoredObject {
  key: string;
  url: string;
  size: number;
  contentType: string;
}

export type StorageDriver = 'local' | 's3-compatible' | 'cloudinary' | 'neon';

export interface IStorageConfig {
  driver: StorageDriver;
  /** Base URL prepended to keys when building a public URL. */
  publicBaseUrl?: string;
  /** Maximum accepted upload size in bytes. */
  maxFileSize: number;
  local: {
    root: string;
  };
  s3: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  /**
   * Neon Object Storage. S3-compatible, so it runs on the same provider class
   * as `s3`, but its credentials arrive under AWS-standard names because that
   * is what Neon injects (`neon env pull`, or automatically inside a Neon
   * Function) — see the IStorageConfig note in configuration.ts for why those
   * are not folded into the `s3` block.
   */
  neon: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/** Injection token for the configured storage provider. */
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
