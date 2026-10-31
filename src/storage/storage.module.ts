import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageConfig, IStorageProvider, STORAGE_PROVIDER } from './interfaces';
import { CloudinaryStorageProvider } from './providers/cloudinary-storage.provider';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { S3CompatibleStorageProvider } from './providers/s3-compatible-storage.provider';
import { StorageService } from './storage.service';

const logger = new Logger('StorageModule');

/**
 * Storage Module
 *
 * Provides a pluggable object-storage system, selected by configuration in the
 * same way `CacheModule` selects a cache backend.
 *
 * - `local` (default): filesystem, so development and CI need no credentials
 * - `cloudinary`: Cloudinary, which has its own API rather than an
 *   S3-compatible one. Assets are stored with authenticated delivery.
 * - `s3-compatible`: any store speaking the S3 wire protocol — Cloudflare R2,
 *   Backblaze B2, Supabase Storage, MinIO and AWS S3. Configured purely
 *   through environment variables.
 * - `neon`: Neon Object Storage, which is also S3-compatible and so runs on
 *   the same provider class, but takes Neon's branch-scoped AWS_* credentials
 *   and always uses path-style addressing (Neon supports nothing else). It can
 *   also split objects across two buckets by key prefix: a private one for
 *   identity documents (signed on every read) and an optional public_read one
 *   for avatars and receipts, whose URLs a client persists.
 *
 * Configuration via environment variables:
 * - STORAGE_DRIVER: 'local' | 'cloudinary' | 's3-compatible' (default: 'local')
 * - STORAGE_PUBLIC_BASE_URL: base URL prepended to object keys
 * - STORAGE_MAX_FILE_SIZE: max upload size in bytes (default: 5242880)
 * - STORAGE_LOCAL_ROOT: directory for the local driver
 * - STORAGE_S3_ENDPOINT / _REGION / _BUCKET / _ACCESS_KEY_ID /
 *   _SECRET_ACCESS_KEY / _FORCE_PATH_STYLE
 * - STORAGE_CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET
 * - neon: AWS_ENDPOINT_URL_S3 / AWS_REGION / AWS_ACCESS_KEY_ID /
 *   AWS_SECRET_ACCESS_KEY (all injected by the Neon CLI) plus
 *   STORAGE_NEON_BUCKET (the bucket declared in neon.ts)
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: (configService: ConfigService): IStorageProvider => {
        const config = configService.get<IStorageConfig>('storage');
        const driver = config?.driver ?? 'local';

        logger.log(`Initializing storage with provider: ${driver}`);

        // Only the S3-protocol drivers' getSignedUrl() actually expires
        // (bug #17). `neon` counts because it presigns through the very same
        // @aws-sdk/s3-request-presigner call as `s3-compatible`.
        //
        // local is dev-only and unserved either way; cloudinary's
        // authenticated-delivery URLs are already signed but can't carry an
        // expiry without a paid add-on this account doesn't have (see the
        // class comment) — so under either, a document's "signed" URL is
        // valid indefinitely once issued. Loud rather than silent, since
        // this storage holds KYC documents.
        const EXPIRING_SIGNED_URL_DRIVERS: readonly string[] = ['s3-compatible', 'neon'];
        if (!EXPIRING_SIGNED_URL_DRIVERS.includes(driver)) {
          logger.warn(
            `Storage driver "${driver}" has no expiring signed URL — getSignedUrl() ` +
              `returns a permanent address. Use one of ` +
              `${EXPIRING_SIGNED_URL_DRIVERS.join(', ')} for anything KYC-sensitive.`,
          );
        }

        if (driver === 'cloudinary' && config) {
          return new CloudinaryStorageProvider({
            cloudName: config.cloudinary.cloudName,
            apiKey: config.cloudinary.apiKey,
            apiSecret: config.cloudinary.apiSecret,
          });
        }

        if (driver === 'neon' && config) {
          // Neon's credentials arrive under AWS-STANDARD names, which anything
          // else on the host may also be using. @nestjs/config never
          // overwrites a variable the process already has, so an exported
          // AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY takes precedence over
          // the same name in .env and this driver signs Neon requests with the
          // host's key instead.
          //
          // The check below reads only the endpoint host, so it catches a
          // shadowed or simply wrong ENDPOINT. It cannot detect shadowed
          // CREDENTIALS — nothing here can, since a foreign key is still a
          // plausible-looking string. Those surface as SigV4 failures, and
          // `env | grep ^AWS_` on the box is what distinguishes them.
          let neonHost = '';
          try {
            neonHost = new URL(config.neon.endpoint).hostname;
          } catch {
            // validateEnv already rejects a non-URL endpoint for this driver;
            // reachable only if configuration() is used without validation.
          }
          if (!neonHost.endsWith('.neon.tech')) {
            logger.warn(
              `STORAGE_DRIVER=neon but AWS_ENDPOINT_URL_S3 host is ` +
                `"${neonHost || config.neon.endpoint}", not a *.neon.tech address. ` +
                'If this is unintended, check whether the host already exports AWS_* ' +
                'variables — real environment variables win over .env/.env.local.',
            );
          }

          // getUrl() returns an unsigned address, and `neon.ts` declares this
          // bucket private, so that address is refused with 403. It is what
          // POST /uploads returns as `url` for avatars and receipts, and what
          // the frontend persists. Reads of KYC documents are unaffected —
          // those go through getSignedUrl().
          //
          // `getUrl()` is synchronous and unsigned, so the address it returns
          // for a PRIVATE bucket is refused (403) — and that address is what
          // POST /uploads hands back as `url` for avatars and receipts, which
          // the frontend then persists. Signing it instead would only move the
          // failure: a presigned URL expires while the caller still has it
          // stored.
          //
          // STORAGE_NEON_PUBLIC_BUCKET is the fix: a second, public_read bucket
          // holding only the prefixes in STORAGE_NEON_PUBLIC_PREFIXES, so those
          // URLs resolve anonymously and indefinitely. Identity documents are
          // NOT among those prefixes — they stay in the private bucket and are
          // signed on every read, which is why this must be a separate bucket
          // rather than opening up the shared one.
          if (!config.neon.publicBucket && !config.publicBaseUrl) {
            logger.warn(
              'STORAGE_DRIVER=neon without STORAGE_NEON_PUBLIC_BUCKET: POST /uploads returns ' +
                'an unsigned URL that the private bucket refuses (403), so avatar and receipt ' +
                'URLs will not load. Declare a public_read bucket in neon.ts and set ' +
                'STORAGE_NEON_PUBLIC_BUCKET to it. Do NOT make the private bucket public — it ' +
                'holds KYC documents. Handyman document reads are unaffected either way.',
            );
          }

          // A public bucket with no prefixes routing to it, and a prefix list
          // containing `handyman-documents` or a '/', are all rejected by
          // validateEnv before boot — see the STORAGE_NEON_PUBLIC_PREFIXES
          // guards in env.validation.ts. Nothing to warn about here.

          return new S3CompatibleStorageProvider({
            endpoint: config.neon.endpoint,
            region: config.neon.region,
            bucket: config.neon.bucket,
            accessKeyId: config.neon.accessKeyId,
            secretAccessKey: config.neon.secretAccessKey,
            // Not configurable: Neon Object Storage supports path-style
            // addressing only, so exposing STORAGE_S3_FORCE_PATH_STYLE here
            // would only let a deployment break itself.
            forcePathStyle: true,
            publicBaseUrl: config.publicBaseUrl,
            publicBucket: config.neon.publicBucket,
            publicKeyPrefixes: config.neon.publicKeyPrefixes,
            providerName: 'neon',
          });
        }

        if (driver === 's3-compatible' && config) {
          return new S3CompatibleStorageProvider({
            endpoint: config.s3.endpoint,
            region: config.s3.region,
            bucket: config.s3.bucket,
            accessKeyId: config.s3.accessKeyId,
            secretAccessKey: config.s3.secretAccessKey,
            forcePathStyle: config.s3.forcePathStyle,
            publicBaseUrl: config.publicBaseUrl,
          });
        }

        return new LocalStorageProvider({
          root: config?.local.root ?? './storage/uploads',
          publicBaseUrl: config?.publicBaseUrl ?? 'http://localhost:3000/uploads',
        });
      },
      inject: [ConfigService],
    },
    StorageService,
  ],
  exports: [StorageService, STORAGE_PROVIDER],
})
export class StorageModule {}
