import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  IStorageProvider,
  IStorageUploadInput,
  IStoredObject,
  STORAGE_PROVIDER,
} from './interfaces';

/**
 * Storage Service
 *
 * Thin wrapper over the configured storage provider, mirroring `CacheService`.
 * Inject this rather than the provider token so business logic never needs to
 * know which driver is active.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly provider: IStorageProvider,
  ) {}

  upload(input: IStorageUploadInput): Promise<IStoredObject> {
    return this.provider.upload(input);
  }

  async delete(key: string): Promise<void> {
    try {
      await this.provider.delete(key);
    } catch (error) {
      // Deleting a stored object is always best-effort cleanup; failing it must
      // not fail the caller's request.
      this.logger.error(`Failed to delete object ${key}: ${error}`);
    }
  }

  getUrl(key: string): string {
    return this.provider.getUrl(key);
  }

  getProviderName(): string {
    return this.provider.getProviderName();
  }
}
