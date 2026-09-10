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
   */
  getUrl(key: string): string;

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

export type StorageDriver = 'local' | 's3-compatible' | 'cloudinary';

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
}

/** Injection token for the configured storage provider. */
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
