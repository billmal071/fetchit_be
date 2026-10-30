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
 *   and always uses path-style addressing (Neon supports nothing else).
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
          // Do NOT "fix" this by making the bucket public_read.
          // STORAGE_PUBLIC_BASE_URL only changes the address that is built; it
          // cannot make a private object readable. The only way it resolves is
          // if the bucket itself allows anonymous reads — and `fetchit-uploads`
          // holds handyman KYC documents under the same prefixes as avatars and
          // receipts, so opening it up would publish identity documents to
          // anyone with a key. There is no per-prefix routing to separate them.
          //
          // So the two real options are a SEPARATE public_read bucket for
          // avatars and receipts only, or callers storing the key and signing
          // on read. Both are follow-up work, which is why this warns rather
          // than refusing: document reads — what this driver is primarily for —
          // already sign on read and are unaffected.
          if (!config.publicBaseUrl) {
            logger.warn(
              'STORAGE_DRIVER=neon: POST /uploads returns an unsigned object URL, which a ' +
                'private bucket refuses (403), so avatar and receipt URLs will not load. ' +
                'Do NOT make this bucket public_read to work around it — it also holds KYC ' +
                'documents. Use a separate public bucket for those two purposes, or store the ' +
                'key and sign on read. Handyman document reads are unaffected.',
            );
          }

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
