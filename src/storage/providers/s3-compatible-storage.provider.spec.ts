import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  S3CompatibleStorageProvider,
  IS3CompatibleStorageOptions,
} from './s3-compatible-storage.provider';

function createProvider(overrides: Partial<IS3CompatibleStorageOptions> = {}): {
  provider: S3CompatibleStorageProvider;
  send: jest.Mock;
} {
  const send = jest.fn().mockResolvedValue({});
  const client = { send } as unknown as S3Client;

  const provider = new S3CompatibleStorageProvider({
    region: 'auto',
    bucket: 'fetchit-documents',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    forcePathStyle: true,
    client,
    ...overrides,
  });

  return { provider, send };
}

describe('S3CompatibleStorageProvider', () => {
  it('puts the object with the sniffed content type and server-generated key', async () => {
    const { provider, send } = createProvider({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
    });
    const body = Buffer.from('%PDF-1.7');

    const stored = await provider.upload({
      key: 'handyman-documents/p1/selfie/abc.pdf',
      body,
      contentType: 'application/pdf',
    });

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'fetchit-documents',
      Key: 'handyman-documents/p1/selfie/abc.pdf',
      ContentType: 'application/pdf',
      ContentLength: body.length,
    });
    expect(stored.size).toBe(body.length);
  });

  it('deletes by key', async () => {
    const { provider, send } = createProvider();

    await provider.delete('handyman-documents/p1/selfie/abc.pdf');

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'fetchit-documents',
      Key: 'handyman-documents/p1/selfie/abc.pdf',
    });
  });

  it('rejects an unsafe key before it reaches the bucket', async () => {
    const { provider, send } = createProvider();

    await expect(
      provider.upload({
        key: '../other/abc.pdf',
        body: Buffer.from('x'),
        contentType: 'image/png',
      }),
    ).rejects.toThrow(/Unsafe storage key/);
    expect(send).not.toHaveBeenCalled();
  });

  describe('getUrl', () => {
    it('prefers an explicit public base URL (CDN or R2 public bucket domain)', () => {
      const { provider } = createProvider({
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        publicBaseUrl: 'https://files.fetchit.com.ng/',
      });

      expect(provider.getUrl('a/b.pdf')).toBe('https://files.fetchit.com.ng/a/b.pdf');
    });

    it('builds a path-style URL, as Cloudflare R2 and MinIO require', () => {
      const { provider } = createProvider({
        endpoint: 'https://acct.r2.cloudflarestorage.com',
      });

      expect(provider.getUrl('a/b.pdf')).toBe(
        'https://acct.r2.cloudflarestorage.com/fetchit-documents/a/b.pdf',
      );
    });

    it('builds a virtual-host URL when path style is off', () => {
      const { provider } = createProvider({
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        forcePathStyle: false,
      });

      expect(provider.getUrl('a/b.pdf')).toBe(
        'https://fetchit-documents.acct.r2.cloudflarestorage.com/a/b.pdf',
      );
    });

    it('falls back to the AWS S3 URL shape when no endpoint is configured', () => {
      const { provider } = createProvider({ region: 'eu-west-1' });

      expect(provider.getUrl('a/b.pdf')).toBe(
        'https://fetchit-documents.s3.eu-west-1.amazonaws.com/a/b.pdf',
      );
    });
  });

  it('reports its provider name', () => {
    expect(createProvider().provider.getProviderName()).toBe('s3-compatible');
  });
});
