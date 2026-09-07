import { Writable } from 'stream';
import {
  CloudinaryStorageProvider,
  ICloudinaryClient,
  ICloudinaryStorageOptions,
} from './cloudinary-storage.provider';

interface IUploadCall {
  options: Record<string, unknown>;
  body: Buffer;
}

function createProvider(overrides: Partial<ICloudinaryStorageOptions> = {}): {
  provider: CloudinaryStorageProvider;
  uploads: IUploadCall[];
  destroy: jest.Mock;
  url: jest.Mock;
} {
  const uploads: IUploadCall[] = [];
  const destroy = jest.fn().mockResolvedValue({ result: 'ok' });
  const url = jest.fn(
    (publicId: string, options: Record<string, unknown>) =>
      `https://res.cloudinary.com/demo/${String(options.resource_type)}/${String(
        options.type,
      )}/s--sig--/${publicId}${options.format ? `.${String(options.format)}` : ''}`,
  );

  const client: ICloudinaryClient = {
    uploader: {
      upload_stream: (options, callback) => {
        const chunks: Buffer[] = [];
        return new Writable({
          write(chunk: Buffer, _encoding, next): void {
            chunks.push(chunk);
            next();
          },
          final(next): void {
            const body = Buffer.concat(chunks);
            uploads.push({ options, body });
            callback(null, { bytes: body.length });
            next();
          },
        });
      },
      destroy,
    },
    url,
  };

  const provider = new CloudinaryStorageProvider({
    cloudName: 'demo',
    apiKey: 'key',
    apiSecret: 'secret',
    client,
    ...overrides,
  });

  return { provider, uploads, destroy, url };
}

describe('CloudinaryStorageProvider', () => {
  describe('images', () => {
    const key = 'handyman-documents/p1/selfie/abc.png';

    it('uploads under an extensionless public id with authenticated delivery', async () => {
      const { provider, uploads } = createProvider();
      const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const stored = await provider.upload({ key, body, contentType: 'image/png' });

      expect(uploads).toHaveLength(1);
      expect(uploads[0].body).toEqual(body);
      expect(uploads[0].options).toMatchObject({
        // The extension is the format for an image, not part of the id.
        public_id: 'handyman-documents/p1/selfie/abc',
        resource_type: 'image',
        // Never the default 'upload' type, which serves KYC documents to
        // anyone holding the URL without a signature.
        type: 'authenticated',
        overwrite: false,
        use_filename: false,
        unique_filename: false,
      });

      expect(stored).toEqual({
        key,
        url: 'https://res.cloudinary.com/demo/image/authenticated/s--sig--/handyman-documents/p1/selfie/abc.png',
        size: body.length,
        contentType: 'image/png',
      });
    });

    it('signs delivery URLs and keeps SDK analytics out of them', () => {
      const { provider, url } = createProvider();

      provider.getUrl(key);

      expect(url).toHaveBeenCalledWith('handyman-documents/p1/selfie/abc', {
        resource_type: 'image',
        type: 'authenticated',
        format: 'png',
        sign_url: true,
        secure: true,
        analytics: false,
      });
    });

    it('deletes using the same public id it uploaded under', async () => {
      const { provider, destroy } = createProvider();

      await provider.delete(key);

      expect(destroy).toHaveBeenCalledWith('handyman-documents/p1/selfie/abc', {
        resource_type: 'image',
        type: 'authenticated',
        invalidate: true,
      });
    });
  });

  describe('PDFs', () => {
    const key = 'handyman-documents/p1/government_id/abc.pdf';

    /**
     * PDF delivery under Cloudinary's `image` type is disabled by default, so
     * a PDF stored that way uploads fine and then fails to download. Raw also
     * addresses assets differently: the extension stays part of the id.
     */
    it('stores them as raw, extension included in the public id', async () => {
      const { provider, uploads } = createProvider();

      const stored = await provider.upload({
        key,
        body: Buffer.from('%PDF-1.7'),
        contentType: 'application/pdf',
      });

      expect(uploads[0].options).toMatchObject({
        public_id: key,
        resource_type: 'raw',
        type: 'authenticated',
      });
      expect(stored.url).toBe(`https://res.cloudinary.com/demo/raw/authenticated/s--sig--/${key}`);
    });

    it('does not pass a format for raw assets', () => {
      const { provider, url } = createProvider();

      provider.getUrl(key);

      expect(url).toHaveBeenCalledWith(key, {
        resource_type: 'raw',
        type: 'authenticated',
        sign_url: true,
        secure: true,
        analytics: false,
      });
    });

    it('deletes as raw', async () => {
      const { provider, destroy } = createProvider();

      await provider.delete(key);

      expect(destroy).toHaveBeenCalledWith(key, {
        resource_type: 'raw',
        type: 'authenticated',
        invalidate: true,
      });
    });
  });

  it('reports the size Cloudinary stored rather than assuming the buffer length', async () => {
    const { provider } = createProvider();

    const stored = await provider.upload({
      key: 'avatars/u1/abc.jpg',
      body: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]),
      contentType: 'image/jpeg',
    });

    expect(stored.size).toBe(5);
  });

  it('rejects a traversing key before it reaches Cloudinary', async () => {
    const { provider, uploads } = createProvider();

    await expect(
      provider.upload({
        key: 'avatars/../../etc/passwd.png',
        body: Buffer.from('x'),
        contentType: 'image/png',
      }),
    ).rejects.toThrow();
    expect(uploads).toHaveLength(0);
  });

  it('surfaces an upload failure rather than resolving with no object', async () => {
    const failing: ICloudinaryClient = {
      uploader: {
        upload_stream: (_options, callback) =>
          new Writable({
            write(_chunk, _encoding, next): void {
              next();
            },
            final(next): void {
              callback(new Error('Invalid Signature'));
              next();
            },
          }),
        destroy: jest.fn(),
      },
      url: jest.fn(() => 'https://res.cloudinary.com/demo/x'),
    };
    const { provider } = createProvider({ client: failing });

    await expect(
      provider.upload({
        key: 'avatars/u1/abc.png',
        body: Buffer.from('x'),
        contentType: 'image/png',
      }),
    ).rejects.toThrow('Invalid Signature');
  });

  it('names itself for health output', () => {
    expect(createProvider().provider.getProviderName()).toBe('cloudinary');
  });
});
