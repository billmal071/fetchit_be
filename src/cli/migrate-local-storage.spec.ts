import {
  mkdtempSync,
  mkdirSync,
  promises as fsPromises,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  IAvatarRow,
  IAvatarRows,
  IMigrationOptions,
  IMigrationResult,
  IMigrationTarget,
  listLocalKeys,
  migrateLocalStorage,
} from './migrate-local-storage';
import type { IStorageUploadInput, IStoredObject } from '@/storage/interfaces';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

const PUBLIC = 'fetchit-public';
const PRIVATE = 'staging';

describe('migrateLocalStorage', () => {
  let root: string;

  const put = (key: string, body: Buffer): void => {
    mkdirSync(dirname(join(root, key)), { recursive: true });
    writeFileSync(join(root, key), body);
  };

  /** In-memory buckets routed by first segment, like the real provider. */
  const makeTarget = (
    buckets: Map<string, Map<string, Buffer>>,
  ): IMigrationTarget & { uploads: IStorageUploadInput[] } => {
    const uploads: IStorageUploadInput[] = [];
    const bucketFor = (key: string): string =>
      ['avatars', 'receipts'].includes(key.split('/')[0]) ? PUBLIC : PRIVATE;
    return {
      uploads,
      bucketFor,
      getUrl: (key) => `https://neon.example/${bucketFor(key)}/${key}`,
      upload: async (input): Promise<IStoredObject> => {
        uploads.push(input);
        const bucket = bucketFor(input.key);
        if (!buckets.has(bucket)) buckets.set(bucket, new Map());
        buckets.get(bucket)!.set(input.key, input.body);
        return {
          key: input.key,
          url: `https://neon.example/${bucket}/${input.key}`,
          size: input.body.length,
          contentType: input.contentType,
        };
      },
    };
  };

  /**
   * users.avatar rows, in memory. `find` matches the way Prisma's `endsWith`
   * does on Postgres - a LIKE, where `_` is any one character and `%` any run -
   * so the tests see the same over-matching the real query produces.
   */
  const makeAvatars = (rows: Array<string | null>): IAvatarRows & { rows: typeof rows } => {
    const likeSuffix = (suffix: string): RegExp =>
      new RegExp(
        `${suffix
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/_/g, '.')
          .replace(/%/g, '.*')}$`,
      );
    return {
      rows,
      find: async (suffix): Promise<IAvatarRow[]> =>
        rows.flatMap((avatar, index) =>
          avatar !== null && likeSuffix(suffix).test(avatar) ? [{ id: `${index}`, avatar }] : [],
        ),
      // Compare-and-set, like the real update: only rows still holding the
      // value `find` returned change.
      update: async (targets, url): Promise<number> => {
        let changed = 0;
        for (const target of targets) {
          const index = Number(target.id);
          if (rows[index] === target.avatar) {
            rows[index] = url;
            changed += 1;
          }
        }
        return changed;
      },
    };
  };

  type Buckets = Map<string, Map<string, Buffer>>;
  interface IRun {
    target: ReturnType<typeof makeTarget>;
    avatars: IAvatarRows;
    buckets: Buckets;
    result: Promise<IMigrationResult>;
  }

  const run = (overrides: Partial<IMigrationOptions> & { buckets?: Buckets } = {}): IRun => {
    const buckets = overrides.buckets ?? new Map<string, Map<string, Buffer>>();
    const target = (overrides.target as ReturnType<typeof makeTarget>) ?? makeTarget(buckets);
    const avatars = overrides.avatars ?? makeAvatars([]);
    return {
      target,
      avatars,
      buckets,
      result: migrateLocalStorage({
        root,
        target,
        avatars,
        dryRun: false,
        isPubliclyReadable: (key) => target.bucketFor(key) === PUBLIC,
        headObject: async (bucket, key) => buckets.get(bucket)?.get(key)?.length ?? null,
        log: () => undefined,
        ...overrides,
      }),
    };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'migrate-local-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies each key to the bucket the provider routes it to, with a sniffed content type', async () => {
    put('avatars/u1/a.png', PNG);
    put('handyman-documents/p1/government_id/d.pdf', PDF);

    const { result, buckets, target } = run();
    const outcome = await result;

    expect(outcome.copied).toEqual([
      'avatars/u1/a.png',
      'handyman-documents/p1/government_id/d.pdf',
    ]);
    expect(buckets.get(PUBLIC)?.has('avatars/u1/a.png')).toBe(true);
    expect(buckets.get(PRIVATE)?.has('handyman-documents/p1/government_id/d.pdf')).toBe(true);
    // A KYC document must never land in the public bucket.
    expect(buckets.get(PUBLIC)?.has('handyman-documents/p1/government_id/d.pdf')).toBeFalsy();
    expect(target.uploads.map((u) => u.contentType)).toEqual(['image/png', 'application/pdf']);
  });

  it('writes nothing — no uploads, no row changes — in a dry run, but reports what it would do', async () => {
    put('avatars/u1/a.png', PNG);
    const avatars = makeAvatars(['http://localhost:3000/uploads/avatars/u1/a.png']);

    const { result, target } = run({ dryRun: true, avatars });
    const outcome = await result;

    expect(target.uploads).toHaveLength(0);
    expect(avatars.rows).toEqual(['http://localhost:3000/uploads/avatars/u1/a.png']);
    expect(outcome.copied).toEqual(['avatars/u1/a.png']);
    expect(outcome.avatarRowsUpdated).toBe(1);
  });

  it('skips a key already in Neon at the same size, so a re-run is a no-op', async () => {
    put('avatars/u1/a.png', PNG);
    const buckets = new Map([[PUBLIC, new Map([['avatars/u1/a.png', PNG]])]]);

    const { result, target } = run({ buckets });
    const outcome = await result;

    expect(target.uploads).toHaveLength(0);
    expect(outcome.alreadyPresent).toEqual(['avatars/u1/a.png']);
  });

  it('leaves a key that is in Neon at a different size alone, and reports it', async () => {
    put('handyman-documents/p1/d.pdf', PDF);
    const buckets = new Map([
      [PRIVATE, new Map([['handyman-documents/p1/d.pdf', Buffer.from('x')]])],
    ]);

    const { result, target } = run({ buckets });
    const outcome = await result;

    expect(target.uploads).toHaveLength(0);
    expect(outcome.conflicts).toEqual(['handyman-documents/p1/d.pdf']);
    expect(buckets.get(PRIVATE)?.get('handyman-documents/p1/d.pdf')?.toString()).toBe('x');
  });

  it('repoints only the avatar rows that end in a migrated key', async () => {
    put('avatars/u1/a.png', PNG);
    const avatars = makeAvatars([
      'http://localhost:3000/uploads/avatars/u1/a.png',
      'https://lh3.googleusercontent.com/a/oauth-picture',
      null,
      'http://localhost:3000/uploads/avatars/u2/other.png',
    ]);

    const { result } = run({ avatars });
    const outcome = await result;

    expect(outcome.avatarRowsUpdated).toBe(1);
    expect(avatars.rows).toEqual([
      `https://neon.example/${PUBLIC}/avatars/u1/a.png`,
      'https://lh3.googleusercontent.com/a/oauth-picture',
      null,
      'http://localhost:3000/uploads/avatars/u2/other.png',
    ]);
  });

  it('repoints avatars that were already copied by an earlier run', async () => {
    put('avatars/u1/a.png', PNG);
    const buckets = new Map([[PUBLIC, new Map([['avatars/u1/a.png', PNG]])]]);
    const avatars = makeAvatars(['http://old/uploads/avatars/u1/a.png']);

    const { result } = run({ buckets, avatars });
    await result;

    expect(avatars.rows).toEqual([`https://neon.example/${PUBLIC}/avatars/u1/a.png`]);
  });

  it('does not repoint an avatar whose Neon URL would need a signature', async () => {
    put('avatars/u1/a.png', PNG);
    const avatars = makeAvatars(['http://old/uploads/avatars/u1/a.png']);

    const { result } = run({ avatars, isPubliclyReadable: () => false });
    const outcome = await result;

    expect(outcome.copied).toEqual(['avatars/u1/a.png']);
    expect(outcome.avatarsNotPublic).toEqual(['avatars/u1/a.png']);
    expect(avatars.rows).toEqual(['http://old/uploads/avatars/u1/a.png']);
  });

  it('never rewrites an avatar row for a failed copy', async () => {
    put('avatars/u1/a.png', PNG);
    const avatars = makeAvatars(['http://old/uploads/avatars/u1/a.png']);
    const target = makeTarget(new Map());
    target.upload = async (): Promise<IStoredObject> => {
      throw new Error('AccessDenied');
    };

    const { result } = run({ avatars, target });
    const outcome = await result;

    expect(outcome.failed).toEqual([{ key: 'avatars/u1/a.png', error: 'AccessDenied' }]);
    expect(avatars.rows).toEqual(['http://old/uploads/avatars/u1/a.png']);
  });

  it('records a failure and carries on with the remaining keys', async () => {
    put('avatars/u1/a.png', PNG);
    put('handyman-documents/p1/d.pdf', PDF);

    const { result } = run({
      headObject: async (_bucket, key) => {
        if (key.startsWith('avatars/')) throw new Error('503 SlowDown');
        return null;
      },
    });
    const outcome = await result;

    expect(outcome.failed).toEqual([{ key: 'avatars/u1/a.png', error: '503 SlowDown' }]);
    expect(outcome.copied).toEqual(['handyman-documents/p1/d.pdf']);
  });

  it('skips files that are not valid storage keys rather than uploading them', async () => {
    put('.gitkeep', Buffer.from(''));
    put('avatars/u1/has space.png', PNG);

    const { result, target } = run();
    const outcome = await result;

    expect(outcome.unsafe.sort()).toEqual(['.gitkeep', 'avatars/u1/has space.png']);
    expect(target.uploads).toHaveLength(0);
  });

  it('falls back to application/octet-stream for bytes it cannot identify', async () => {
    put('receipts/u1/r.bin', Buffer.from('not a known format'));

    const { result, target } = run();
    await result;

    expect(target.uploads[0].contentType).toBe('application/octet-stream');
  });

  it('treats `_` in a key literally, so it never repoints an avatar that only LIKE-matches', async () => {
    put('avatars/u1/a_b.png', PNG);
    // `_` is a LIKE wildcard, so the query for `/avatars/u1/a_b.png` also
    // returns this other user's `a-b.png`. Only the exact match may change.
    const avatars = makeAvatars([
      'http://old/uploads/avatars/u1/a_b.png',
      'http://old/uploads/avatars/u1/a-b.png',
    ]);

    const { result } = run({ avatars });
    const outcome = await result;

    expect(outcome.avatarRowsUpdated).toBe(1);
    expect(avatars.rows).toEqual([
      `https://neon.example/${PUBLIC}/avatars/u1/a_b.png`,
      'http://old/uploads/avatars/u1/a-b.png',
    ]);
  });

  it('leaves an avatar alone if it changed between being read and being rewritten', async () => {
    put('avatars/u1/a.png', PNG);
    const avatars = makeAvatars(['http://old/uploads/avatars/u1/a.png']);
    const find = avatars.find;
    // A Google sign-in links the account and replaces the avatar after the
    // migration has read it but before it writes.
    avatars.find = async (suffix): Promise<IAvatarRow[]> => {
      const found = await find(suffix);
      avatars.rows[0] = 'https://lh3.googleusercontent.com/a/new-picture';
      return found;
    };

    const { result } = run({ avatars });
    const outcome = await result;

    expect(outcome.avatarRowsUpdated).toBe(0);
    expect(avatars.rows).toEqual(['https://lh3.googleusercontent.com/a/new-picture']);
  });

  it('records an unreadable directory as a failure and still migrates everything else', async () => {
    put('avatars/u1/a.png', PNG);
    put('handyman-documents/p1/d.pdf', PDF);
    const realReaddir = fsPromises.readdir.bind(fsPromises);
    const spy = jest
      .spyOn(fsPromises, 'readdir')
      .mockImplementation(((dir: string, options: unknown) =>
        String(dir).endsWith('avatars')
          ? Promise.reject(new Error('EACCES: permission denied'))
          : realReaddir(dir, options as never)) as never);

    try {
      const { result } = run();
      const outcome = await result;

      expect(outcome.failed).toEqual([
        { key: 'avatars/', error: 'could not list directory: EACCES: permission denied' },
      ]);
      expect(outcome.copied).toEqual(['handyman-documents/p1/d.pdf']);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not read the bytes of a file that is already in Neon', async () => {
    put('avatars/u1/a.png', PNG);
    const buckets = new Map([[PUBLIC, new Map([['avatars/u1/a.png', PNG]])]]);
    const spy = jest.spyOn(fsPromises, 'readFile');

    try {
      const { result } = run({ buckets });
      await result;

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('listLocalKeys', () => {
  it('returns /-separated keys for regular files and ignores symlinks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'list-local-'));
    try {
      mkdirSync(join(root, 'avatars', 'u1'), { recursive: true });
      writeFileSync(join(root, 'avatars', 'u1', 'a.png'), PNG);
      symlinkSync('/etc/passwd', join(root, 'avatars', 'u1', 'link.png'));

      await expect(listLocalKeys(root)).resolves.toEqual({
        keys: ['avatars/u1/a.png'],
        unreadable: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
