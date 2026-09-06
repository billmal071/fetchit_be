import { promises as fs } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { Logger } from '@nestjs/common';
import { IStorageProvider, IStorageUploadInput, IStoredObject } from '../interfaces';
import { assertSafeStorageKey, joinUrl } from '../storage.util';

export interface ILocalStorageOptions {
  /** Directory objects are written under. */
  root: string;
  /** Base URL used to build the returned object URL. */
  publicBaseUrl: string;
}

/**
 * Filesystem storage driver.
 *
 * The default so the app boots, and the test suite runs, with no cloud
 * credentials. Intended for development only: nothing serves these files over
 * HTTP (KYC documents must not sit behind an unauthenticated static route), so
 * the returned URL is an address you would only be able to resolve once a real
 * object store is configured.
 */
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(options: ILocalStorageOptions) {
    this.root = resolve(options.root);
    this.publicBaseUrl = options.publicBaseUrl;
    this.logger.log(`Local storage initialized at ${this.root}`);
  }

  private resolveKey(key: string): string {
    assertSafeStorageKey(key);
    const target = resolve(join(this.root, key));
    // Belt and braces: even with a validated key, never write outside the root.
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
    }
    return target;
  }

  async upload(input: IStorageUploadInput): Promise<IStoredObject> {
    const target = this.resolveKey(input.key);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, input.body);

    return {
      key: input.key,
      url: this.getUrl(input.key),
      size: input.body.length,
      contentType: input.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    await fs.rm(target, { force: true });
  }

  getUrl(key: string): string {
    return joinUrl(this.publicBaseUrl, key);
  }

  getProviderName(): string {
    return 'local';
  }
}
