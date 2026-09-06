import { Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { IStorageProvider, IStorageUploadInput, IStoredObject } from '../interfaces';
import { assertSafeStorageKey, joinUrl } from '../storage.util';

export interface IS3StorageOptions {
  /**
   * Custom S3 endpoint. Leave unset for AWS S3; set it for Cloudflare R2
   * (`https://<account>.r2.cloudflarestorage.com`), Supabase Storage
   * (`https://<ref>.supabase.co/storage/v1/s3`) or MinIO.
   */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required by MinIO and Supabase; harmless on R2. */
  forcePathStyle: boolean;
  /** Base URL for returned object URLs (e.g. a CDN or R2 public bucket domain). */
  publicBaseUrl?: string;
  /** Injectable for tests. */
  client?: S3Client;
}

/**
 * S3-compatible storage driver.
 *
 * Everything vendor-specific (endpoint, region, bucket, credentials, path
 * style) comes from configuration, so the same code runs unchanged against
 * Cloudflare R2, AWS S3, Supabase Storage and MinIO.
 */
export class S3StorageProvider implements IStorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;
  private readonly endpoint?: string;
  private readonly region: string;
  private readonly forcePathStyle: boolean;

  constructor(options: IS3StorageOptions) {
    this.bucket = options.bucket;
    this.publicBaseUrl = options.publicBaseUrl;
    this.endpoint = options.endpoint;
    this.region = options.region;
    this.forcePathStyle = options.forcePathStyle;

    this.client =
      options.client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        forcePathStyle: options.forcePathStyle,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });

    this.logger.log(
      `S3 storage initialized (bucket=${this.bucket}, endpoint=${this.endpoint ?? 'aws'})`,
    );
  }

  async upload(input: IStorageUploadInput): Promise<IStoredObject> {
    assertSafeStorageKey(input.key);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.length,
      }),
    );

    return {
      key: input.key,
      url: this.getUrl(input.key),
      size: input.body.length,
      contentType: input.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getUrl(key: string): string {
    if (this.publicBaseUrl) {
      return joinUrl(this.publicBaseUrl, key);
    }

    if (this.endpoint) {
      const base = this.endpoint.replace(/\/+$/, '');
      return this.forcePathStyle
        ? `${base}/${this.bucket}/${key}`
        : base.replace(/^(https?:\/\/)/, `$1${this.bucket}.`) + `/${key}`;
    }

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  getProviderName(): string {
    return 's3';
  }
}
