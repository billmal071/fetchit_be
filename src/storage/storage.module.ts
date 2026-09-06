import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageConfig, IStorageProvider, STORAGE_PROVIDER } from './interfaces';
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
 * - `s3-compatible`: any store speaking the S3 wire protocol. Cloudflare R2 is
 *   the intended target; Backblaze B2, Supabase Storage, MinIO and AWS S3 also
 *   work. Configured purely through environment variables.
 *
 * Configuration via environment variables:
 * - STORAGE_DRIVER: 'local' | 's3-compatible' (default: 'local')
 * - STORAGE_PUBLIC_BASE_URL: base URL prepended to object keys
 * - STORAGE_MAX_FILE_SIZE: max upload size in bytes (default: 5242880)
 * - STORAGE_LOCAL_ROOT: directory for the local driver
 * - STORAGE_S3_ENDPOINT / _REGION / _BUCKET / _ACCESS_KEY_ID /
 *   _SECRET_ACCESS_KEY / _FORCE_PATH_STYLE
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
