import { promises as fs } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider', () => {
  let root: string;
  let provider: LocalStorageProvider;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fetchit-storage-'));
    provider = new LocalStorageProvider({
      root,
      publicBaseUrl: 'https://files.test/uploads/',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the object and returns a resolvable URL', async () => {
    const body = Buffer.from('%PDF-1.7 hello');

    const stored = await provider.upload({
      key: 'handyman-documents/p1/government_id/abc.pdf',
      body,
      contentType: 'application/pdf',
    });

    expect(stored).toEqual({
      key: 'handyman-documents/p1/government_id/abc.pdf',
      // The trailing slash on the base URL must not double up.
      url: 'https://files.test/uploads/handyman-documents/p1/government_id/abc.pdf',
      size: body.length,
      contentType: 'application/pdf',
    });

    const written = await fs.readFile(join(root, 'handyman-documents/p1/government_id/abc.pdf'));
    expect(written.equals(body)).toBe(true);
  });

  it('deletes an object, and treats a missing key as a no-op', async () => {
    await provider.upload({ key: 'a/b.png', body: Buffer.from('x'), contentType: 'image/png' });

    await provider.delete('a/b.png');
    await expect(fs.access(join(root, 'a/b.png'))).rejects.toThrow();

    await expect(provider.delete('a/b.png')).resolves.toBeUndefined();
  });

  it.each([
    ['../escape.png', 'parent traversal'],
    ['/absolute.png', 'absolute path'],
    ['a/../../escape.png', 'traversal mid-key'],
    ['a//b.png', 'empty segment'],
    ['a/b/', 'trailing slash'],
  ])('refuses to write outside its root: %s (%s)', async (key) => {
    await expect(
      provider.upload({ key, body: Buffer.from('x'), contentType: 'image/png' }),
    ).rejects.toThrow(/Unsafe storage key/);

    // Nothing must have been created anywhere under the root either.
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('reports its provider name', () => {
    expect(provider.getProviderName()).toBe('local');
  });
});
