import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from './storage.module';
import { IStorageProvider, STORAGE_PROVIDER } from './interfaces';

/**
 * The provider tests construct `S3CompatibleStorageProvider` directly and the
 * `configuration()` tests stop at the config object, so nothing covered the
 * factory in between. Dropping `publicBucket` or `publicKeyPrefixes` from the
 * `neon` branch used to pass the whole suite while sending every avatar and
 * receipt to the private bucket, where their URLs are refused with 403.
 */
describe('StorageModule STORAGE_PROVIDER factory', () => {
  const neonStorageConfig = {
    driver: 'neon',
    publicBaseUrl: '',
    maxFileSize: 5242880,
    local: { root: './storage/uploads' },
    s3: {},
    cloudinary: {},
    neon: {
      endpoint: 'https://example.neon.tech',
      region: 'us-east-2',
      bucket: 'fetchit-uploads',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      publicBucket: 'fetchit-public',
      publicKeyPrefixes: ['avatars', 'receipts'],
    },
  };

  // Goes through the real ConfigService rather than a stub, so the factory's
  // `configService.get<IStorageConfig>('storage')` lookup is exercised too — a
  // renamed config key would fail here instead of silently yielding `local`.
  const buildProvider = async (storage: unknown): Promise<IStorageProvider> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [(): Record<string, unknown> => (storage === undefined ? {} : { storage })],
        }),
        StorageModule,
      ],
    }).compile();

    return moduleRef.get<IStorageProvider>(STORAGE_PROVIDER);
  };

  it('routes a public prefix to the public bucket and documents to the private one', async () => {
    const provider = await buildProvider(neonStorageConfig);

    expect(provider.getUrl('avatars/u1/a.png')).toBe(
      'https://example.neon.tech/fetchit-public/avatars/u1/a.png',
    );
    expect(provider.getUrl('receipts/r1/r.pdf')).toBe(
      'https://example.neon.tech/fetchit-public/receipts/r1/r.pdf',
    );
    expect(provider.getUrl('handyman-documents/h1/id/x.jpg')).toBe(
      'https://example.neon.tech/fetchit-uploads/handyman-documents/h1/id/x.jpg',
    );
  });

  it('names itself neon rather than the generic S3 driver', async () => {
    const provider = await buildProvider(neonStorageConfig);

    expect(provider.getProviderName()).toBe('neon');
  });

  it('keeps every key in the single bucket when no public bucket is configured', async () => {
    const provider = await buildProvider({
      ...neonStorageConfig,
      neon: { ...neonStorageConfig.neon, publicBucket: undefined },
    });

    expect(provider.getUrl('avatars/u1/a.png')).toBe(
      'https://example.neon.tech/fetchit-uploads/avatars/u1/a.png',
    );
  });

  it('honours a narrowed prefix list, leaving receipts private', async () => {
    const provider = await buildProvider({
      ...neonStorageConfig,
      neon: { ...neonStorageConfig.neon, publicKeyPrefixes: ['avatars'] },
    });

    expect(provider.getUrl('avatars/u1/a.png')).toBe(
      'https://example.neon.tech/fetchit-public/avatars/u1/a.png',
    );
    expect(provider.getUrl('receipts/r1/r.pdf')).toBe(
      'https://example.neon.tech/fetchit-uploads/receipts/r1/r.pdf',
    );
  });

  it('falls back to the local driver when no storage config is present', async () => {
    const provider = await buildProvider(undefined);

    expect(provider.getProviderName()).toBe('local');
  });
});
