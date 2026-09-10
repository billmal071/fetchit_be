import { Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { IStorageProvider, IStorageUploadInput, IStoredObject } from '../interfaces';
import { assertSafeStorageKey } from '../storage.util';

/**
 * The slice of the Cloudinary SDK this provider uses.
 *
 * Declared as an interface so a test can supply a fake without reaching for the
 * SDK's module-level singleton.
 */
export interface ICloudinaryClient {
  uploader: {
    upload_stream(
      options: Record<string, unknown>,
      callback: (error: unknown, result?: { bytes?: number }) => void,
    ): NodeJS.WritableStream;
    destroy(publicId: string, options: Record<string, unknown>): Promise<unknown>;
  };
  url(publicId: string, options: Record<string, unknown>): string;
}

export interface ICloudinaryStorageOptions {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Injectable for tests. */
  client?: ICloudinaryClient;
}

/** How a storage key maps onto Cloudinary's addressing scheme. */
interface IKeyDescriptor {
  publicId: string;
  resourceType: 'image' | 'raw';
  /** Only set for `image`, where the extension is metadata rather than part of the id. */
  format?: string;
}

/**
 * Cloudinary object storage driver.
 *
 * Cloudinary is not S3-compatible, so this cannot reuse the S3 driver — it
 * talks to Cloudinary's own API. Two of its conventions differ from an object
 * store and drive everything below.
 *
 * **Delivery type.** Assets are uploaded as `authenticated`, not the default
 * `upload`. A default-type asset is served to anyone who has (or guesses) its
 * URL, which is the wrong posture for KYC documents. An `authenticated` asset
 * is only served with a valid signature, which `getUrl` computes from the
 * account secret. Those signatures carry no expiry, so the URL stays valid for
 * as long as the asset exists — which is what lets the URL be persisted in
 * `HandymanDocument.fileUrl` and friends, exactly as with the other drivers.
 * (An expiring URL would need a schema change: the column would have to hold a
 * key and be re-signed on every read.) Treat a stored URL as a bearer
 * credential: unguessable, but anyone holding it can fetch the object.
 *
 * **Resource type.** Cloudinary sorts assets into `image` and `raw`, and
 * addresses the two differently: an `image` public id excludes the file
 * extension (the format is carried separately), while a `raw` public id
 * includes it. PDFs are uploaded as `raw` rather than as the `image` type
 * Cloudinary would otherwise infer, because PDF delivery under the image type
 * is disabled by default on Cloudinary accounts — a document would upload
 * cleanly and then 401 on download. `describeKey` is the single place that
 * resolves both rules, so upload, delete and URL generation cannot drift.
 */
export class CloudinaryStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(CloudinaryStorageProvider.name);
  private readonly client: ICloudinaryClient;

  constructor(options: ICloudinaryStorageOptions) {
    if (options.client) {
      this.client = options.client;
    } else {
      // The SDK keeps its credentials in module-level state. Only one provider
      // is ever constructed (StorageModule builds it once from configuration),
      // so configuring the singleton here is safe.
      cloudinary.config({
        cloud_name: options.cloudName,
        api_key: options.apiKey,
        api_secret: options.apiSecret,
        secure: true,
      });
      this.client = cloudinary as unknown as ICloudinaryClient;
    }

    this.logger.log(`Cloudinary storage initialized (cloud=${options.cloudName})`);
  }

  /**
   * Split a storage key into the public id, resource type and format
   * Cloudinary needs. See the class comment for why the two types differ.
   */
  private describeKey(key: string): IKeyDescriptor {
    assertSafeStorageKey(key);

    const match = /^(.+)\.([A-Za-z0-9]+)$/.exec(key);
    const extension = match?.[2].toLowerCase();

    if (!match || extension === 'pdf') {
      // Raw: the extension stays part of the id. A key with no extension at all
      // is also safest handled as raw, since there is no format to carry.
      return { publicId: key, resourceType: 'raw' };
    }

    return { publicId: match[1], resourceType: 'image', format: extension };
  }

  async upload(input: IStorageUploadInput): Promise<IStoredObject> {
    const { publicId, resourceType } = this.describeKey(input.key);

    const result = await new Promise<{ bytes?: number }>((resolve, reject) => {
      const stream = this.client.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: resourceType,
          type: 'authenticated',
          // The key is already unique (it carries a UUID); refusing to
          // overwrite turns any collision into an error rather than silent
          // data loss.
          overwrite: false,
          // Never let Cloudinary derive an id from the client's filename.
          use_filename: false,
          unique_filename: false,
        },
        (error: unknown, uploaded?: { bytes?: number }) => {
          if (error || !uploaded) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          resolve(uploaded);
        },
      );

      stream.end(input.body);
    });

    return {
      key: input.key,
      url: this.getUrl(input.key),
      size: result.bytes ?? input.body.length,
      contentType: input.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    const { publicId, resourceType } = this.describeKey(key);

    await this.client.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      invalidate: true,
    });
  }

  getUrl(key: string): string {
    const { publicId, resourceType, format } = this.describeKey(key);

    return this.client.url(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      ...(format ? { format } : {}),
      sign_url: true,
      secure: true,
      // Keep the SDK's usage-analytics query string out of a URL that gets
      // written to the database.
      analytics: false,
    });
  }

  getProviderName(): string {
    return 'cloudinary';
  }
}
