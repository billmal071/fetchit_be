import { Logger } from '@nestjs/common';
// `@aws-sdk/client-s3` is the reference client for the S3 *protocol*, not a tie
// to AWS. Cloudflare R2, Backblaze B2, Supabase Storage and MinIO all document
// this exact package as the way to talk to them. No AWS account is involved.
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
  /**
   * Optional second bucket for objects that must stay readable from a plain,
   * non-expiring URL a client can persist — profile pictures and receipts.
   *
   * It exists because `getUrl()` is synchronous and unsigned: against a
   * private bucket the address it returns is refused, and signing instead
   * would hand back a URL that expires while the caller still has it stored.
   * Splitting by bucket keeps identity documents in the private one, where
   * every read is signed, without a second provider or any read-path change.
   *
   * Leave unset and every key uses `bucket`, which is the previous behaviour.
   */
  publicBucket?: string;
  /**
   * Key prefixes routed to `publicBucket`. Matched on the first path segment,
   * so 'avatars' matches `avatars/<user>/<uuid>.png` and nothing else.
   * Ignored when `publicBucket` is unset.
   */
  publicKeyPrefixes?: readonly string[];
  /** Base URL for returned object URLs (e.g. a CDN or R2 public bucket domain). */
  publicBaseUrl?: string;
  /**
   * Name this instance reports from `getProviderName()`. Defaults to
   * 's3-compatible'. Neon Object Storage runs on this same class — it speaks
   * the S3 protocol — so it overrides this to say so, rather than having every
   * log line and error attribute a Neon problem to a generic S3 driver.
   */
  providerName?: string;
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
  private readonly providerName: string;
  private readonly publicBucket?: string;
  private readonly publicKeyPrefixes: readonly string[];

  constructor(options: IS3CompatibleStorageOptions) {
    this.providerName = options.providerName ?? 's3-compatible';
    this.bucket = options.bucket;
    this.publicBucket = options.publicBucket;
    this.publicKeyPrefixes = options.publicKeyPrefixes ?? [];
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
      `${this.providerName} storage initialized (bucket=${this.bucket}, ` +
        (this.publicBucket
          ? `publicBucket=${this.publicBucket} for ${this.publicKeyPrefixes.join('/') || 'nothing'}, `
          : '') +
        `endpoint=${this.endpoint ?? 'aws-s3-default'})`,
    );
  }

  /**
   * Which bucket holds this key. Derived from the key alone, so a key written
   * by `upload()` always resolves to the same bucket on read and delete.
   *
   * Public so tooling that talks to the bucket directly (the local-to-Neon
   * migration in src/cli) routes by this exact rule rather than a copy of it.
   */
  bucketFor(key: string): string {
    if (!this.publicBucket) {
      return this.bucket;
    }

    const firstSegment = key.split('/')[0];

    return this.publicKeyPrefixes.includes(firstSegment) ? this.publicBucket : this.bucket;
  }

  async upload(input: IStorageUploadInput): Promise<IStoredObject> {
    assertSafeStorageKey(input.key);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketFor(input.key),
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
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
  }

  getUrl(key: string): string {
    if (this.publicBaseUrl) {
      return joinUrl(this.publicBaseUrl, key);
    }

    const bucket = this.bucketFor(key);

    if (this.endpoint) {
      const base = this.endpoint.replace(/\/+$/, '');
      return this.forcePathStyle
        ? `${base}/${bucket}/${key}`
        : base.replace(/^(https?:\/\/)/, `$1${bucket}.`) + `/${key}`;
    }

    return `https://${bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertSafeStorageKey(key);

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketFor(key), Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  getProviderName(): string {
    return this.providerName;
  }
}
