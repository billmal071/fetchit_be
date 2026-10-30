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

describe('S3CompatibleStorageProvider.getSignedUrl', () => {
  // Presigning is pure local computation (HMAC over the request + a real
  // S3Client's config/region/endpoint resolution) — no network call happens,
  // so a real client with static credentials is fast and safe to construct
  // here. The lightweight `{ send: jest.fn() }` stub used above can't stand
  // in for it: there is no `send()` to intercept.
  it('returns a presigned GET URL for the key, expiring after expiresInSeconds', async () => {
    const provider = new S3CompatibleStorageProvider({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'fetchit-documents',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });

    const url = await provider.getSignedUrl('handyman-documents/p1/selfie/abc.pdf', 300);
    const parsed = new URL(url);

    // Path-style (forcePathStyle: true): bucket is a path segment, not a subdomain.
    expect(parsed.href).toContain('/fetchit-documents/handyman-documents/p1/selfie/abc.pdf');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    // Presence of a signature is what makes this a *signed* URL rather than
    // the same permanent address getUrl() returns for the same key.
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(parsed.searchParams.get('X-Amz-Credential')).toContain('AKIAEXAMPLE');
  });

  it('rejects a path-traversal key the same way upload/delete do', async () => {
    const provider = new S3CompatibleStorageProvider({
      region: 'auto',
      bucket: 'fetchit-documents',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });

    await expect(provider.getSignedUrl('../../etc/passwd', 300)).rejects.toThrow();
  });
});

/**
 * Neon Object Storage runs on this same class rather than a driver of its own,
 * because it speaks the S3 protocol. These pin the two things that make that
 * reuse safe: the URL shape Neon documents, and an honest provider name.
 */
describe('as the Neon Object Storage driver', () => {
  const neonOptions: IS3CompatibleStorageOptions = {
    endpoint: 'https://br-example-123.storage.us-east-2.aws.neon.tech',
    region: 'us-east-2',
    bucket: 'fetchit-uploads',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    // Neon supports path-style addressing only.
    forcePathStyle: true,
    providerName: 'neon',
  };

  it('builds the object URL Neon documents: <endpoint>/<bucket>/<key>', () => {
    const provider = new S3CompatibleStorageProvider(neonOptions);

    expect(provider.getUrl('avatars/u1/abc.jpg')).toBe(
      'https://br-example-123.storage.us-east-2.aws.neon.tech/fetchit-uploads/avatars/u1/abc.jpg',
    );
  });

  it('reports itself as neon rather than the generic s3-compatible name', () => {
    expect(new S3CompatibleStorageProvider(neonOptions).getProviderName()).toBe('neon');
  });

  it('still defaults to s3-compatible when no name is given', () => {
    const withoutName: IS3CompatibleStorageOptions = { ...neonOptions };
    delete withoutName.providerName;

    expect(new S3CompatibleStorageProvider(withoutName).getProviderName()).toBe('s3-compatible');
  });

  it('presigns an expiring URL, which is why neon is allowed for KYC documents', async () => {
    const provider = new S3CompatibleStorageProvider(neonOptions);

    const parsed = new URL(await provider.getSignedUrl('receipts/u1/r.pdf', 300));

    expect(parsed.pathname).toBe('/fetchit-uploads/receipts/u1/r.pdf');
    // Pins that `endpoint` reaches S3Client. getUrl() builds its URL from
    // this.endpoint directly, so it would keep passing if the option stopped
    // being forwarded and presigning fell back to the default AWS host.
    expect(parsed.host).toBe('br-example-123.storage.us-east-2.aws.neon.tech');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
    // The region is part of the SigV4 credential scope, which is why
    // AWS_REGION is required rather than defaulted for this driver.
    expect(parsed.searchParams.get('X-Amz-Credential')).toContain('us-east-2');
  });
});
