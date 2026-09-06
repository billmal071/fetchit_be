import { Logger } from '@nestjs/common';
// `@aws-sdk/client-s3` is the reference client for the S3 *protocol*, not a tie
// to AWS. Cloudflare R2, Backblaze B2, Supabase Storage and MinIO all document
// this exact package as the way to talk to them. No AWS account is involved.
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { IStorageProvider, IStorageUploadInput, IStoredObject } from '../interfaces';
import { assertSafeStorageKey, joinUrl } from '../storage.util';

export interface IS3CompatibleStorageOptions {
  /**
   * Storage endpoint. Cloudflare R2 (the intended target) uses
   * `https://<account-id>.r2.cloudflarestorage.com`. Also works with Backblaze
   * B2, Supabase Storage and MinIO. Leave unset only for AWS S3 itself, which
   * derives its endpoint from the region.
   */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required by R2, MinIO and Supabase. */
  forcePathStyle: boolean;
  /** Base URL for returned object URLs (e.g. a CDN or R2 public bucket domain). */
  publicBaseUrl?: string;
  /** Injectable for tests. */
  client?: S3Client;
}

/**
 * S3-compatible object storage driver.
 *
 * "S3-compatible" is the name of the wire protocol, not a vendor. Everything
 * that differs between providers (endpoint, region, bucket, credentials, path
 * style) comes from configuration, so the same code runs unchanged against
 * Cloudflare R2 — the intended target — as well as Backblaze B2, Supabase
 * Storage, MinIO and AWS S3.
 */
export class S3CompatibleStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(S3CompatibleStorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;
  private readonly endpoint?: string;
  private readonly region: string;
  private readonly forcePathStyle: boolean;

  constructor(options: IS3CompatibleStorageOptions) {
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
      `S3-compatible storage initialized (bucket=${this.bucket}, ` +
        `endpoint=${this.endpoint ?? 'aws-s3-default'})`,
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
    return 's3-compatible';
  }
}
