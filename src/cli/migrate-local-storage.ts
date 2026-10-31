/**
 * One-off migration: copy files the `local` driver wrote to disk into Neon
 * Object Storage, then point stored avatar URLs at their new home.
 *
 * Switching STORAGE_DRIVER does not move anything. Nothing records which
 * backend wrote a given key, so once the app runs on `neon` it looks every key
 * up in Neon, and anything still on disk stops resolving.
 *
 * Run ON THE SERVER, from APP_PATH, after a deploy with STORAGE_DRIVER=neon:
 *
 *   pnpm storage:migrate-local --dry-run   # list what would happen, change nothing
 *   pnpm storage:migrate-local             # do it
 *
 * It lives in src/ rather than scripts/ because the deploy ships only dist/,
 * so this compiles to dist/cli/migrate-local-storage.js and runs with plain
 * node. It reads the same `.env` the app does, validates it with the app's own
 * schema, and uploads through the app's own provider, so each key lands in the
 * bucket the app will look in (avatars/ and receipts/ in the public bucket,
 * handyman-documents/ in the private one).
 *
 * The deploy workflow also runs it after every successful deploy, with
 * `--only-if-neon` (a no-op on any other driver). Re-running is cheap: after
 * the first pass every key is already in Neon and is skipped.
 *
 * Safe to re-run: a key already in Neon at the same size is skipped. A key in
 * Neon at a DIFFERENT size is reported and left alone rather than overwritten.
 *
 * Avatars need more than a copy. `users.avatar` stores the full URL the old
 * driver handed out, not the key, so after copying `avatars/<...>` the rows
 * ending in `/avatars/<...>` are rewritten to the Neon URL. OAuth avatars are
 * external URLs that end in no migrated key, so they are never touched. This
 * only happens when the avatar's new URL is actually readable without a
 * signature (public bucket, or STORAGE_PUBLIC_BASE_URL); otherwise rewriting
 * would swap one dead link for another.
 *
 * Handyman documents need nothing further: their rows store the key and are
 * signed on read. Receipts have no server-side model to update.
 *
 * The local files are NOT deleted. Remove them by hand once the app is
 * verified against Neon.
 */
/* eslint-disable no-console -- standalone CLI: stdout is its interface */
import { existsSync, promises as fs } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import configuration from '@/config/configuration';
import { validateEnv } from '@/config/env.validation';
import { buildPrismaClientConfig } from '@/database/prisma.service';
import { S3CompatibleStorageProvider } from '@/storage/providers/s3-compatible-storage.provider';
import { assertSafeStorageKey } from '@/storage/storage.util';
import { sniffFileType } from '@common/utils/file-type.util';
import type { IStorageUploadInput, IStoredObject } from '@/storage/interfaces';

/** Only users.avatar holds storage URLs; every other column holds a key. */
export const AVATAR_PREFIX = 'avatars';

const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

export interface IMigrationTarget {
  bucketFor(key: string): string;
  upload(input: IStorageUploadInput): Promise<IStoredObject>;
  getUrl(key: string): string;
}

export interface IAvatarRow {
  id: string;
  avatar: string;
}

export interface IAvatarRows {
  /**
   * CANDIDATE rows whose avatar may end with `suffix`. Allowed to over-match:
   * Prisma's `endsWith` is a SQL LIKE, where `_` in a key is a wildcard.
   * migrateLocalStorage re-checks each candidate exactly before touching it.
   */
  find(suffix: string): Promise<IAvatarRow[]>;
  /** Point these rows at `url`; returns how many changed. */
  update(ids: string[], url: string): Promise<number>;
}

export interface IMigrationOptions {
  /** STORAGE_LOCAL_ROOT, resolved. */
  root: string;
  target: IMigrationTarget;
  /** Size of the object in the bucket, or null if it is absent. */
  headObject(bucket: string, key: string): Promise<number | null>;
  avatars: IAvatarRows;
  /** Whether getUrl(key) resolves without a signature. */
  isPubliclyReadable(key: string): boolean;
  dryRun: boolean;
  log?: (line: string) => void;
}

export interface IMigrationResult {
  copied: string[];
  alreadyPresent: string[];
  /** In the bucket at a different size: left alone, needs a human. */
  conflicts: string[];
  /** Not a valid storage key, so the app could never have produced it. */
  unsafe: string[];
  failed: Array<{ key: string; error: string }>;
  /** users.avatar rows rewritten (or that would be, in a dry run). */
  avatarRowsUpdated: number;
  /** Avatars copied but whose URL would not resolve, so rows left alone. */
  avatarsNotPublic: string[];
}

export interface ILocalListing {
  keys: string[];
  /** Directories that could not be read; everything else is still listed. */
  unreadable: Array<{ dir: string; error: string }>;
}

/**
 * Every regular file under `root`, as a `/`-separated key. Symlinks are
 * skipped. A directory that cannot be read (permissions, say) is recorded and
 * skipped rather than aborting the walk, so one bad directory cannot stop
 * every other file from migrating.
 */
export async function listLocalKeys(root: string): Promise<ILocalListing> {
  const keys: string[] = [];
  const unreadable: ILocalListing['unreadable'] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      unreadable.push({
        dir: relative(root, dir).split(sep).join('/') || '.',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        keys.push(relative(root, path).split(sep).join('/'));
      }
    }
  };

  await walk(root);
  return { keys: keys.sort(), unreadable };
}

const isAvatarKey = (key: string): boolean => key.split('/')[0] === AVATAR_PREFIX;

export async function migrateLocalStorage(options: IMigrationOptions): Promise<IMigrationResult> {
  const { root, target, headObject, avatars, isPubliclyReadable, dryRun } = options;
  const log = options.log ?? ((line: string): void => console.log(line));
  const verb = dryRun ? 'would copy' : 'copied';

  const result: IMigrationResult = {
    copied: [],
    alreadyPresent: [],
    conflicts: [],
    unsafe: [],
    failed: [],
    avatarRowsUpdated: 0,
    avatarsNotPublic: [],
  };

  // Keys now present in the target, so their avatar rows may be repointed.
  const inTarget: string[] = [];

  const listing = await listLocalKeys(root);
  for (const { dir, error } of listing.unreadable) {
    result.failed.push({ key: `${dir}/`, error: `could not list directory: ${error}` });
    log(`  [FAIL]  ${dir}/ — could not list directory: ${error}`);
  }

  for (const key of listing.keys) {
    try {
      assertSafeStorageKey(key);
    } catch {
      result.unsafe.push(key);
      log(`  [skip]  ${key} — not a valid storage key, so the app never wrote it`);
      continue;
    }

    try {
      const bucket = target.bucketFor(key);
      const path = join(root, key);
      // Size from stat, not the bytes: this runs after every deploy, and after
      // the first pass nearly every key is already in Neon, so reading each
      // file just to compare a length would make the no-op scale with disk.
      const { size } = await fs.stat(path);
      const existingSize = await headObject(bucket, key);

      if (existingSize !== null) {
        if (existingSize === size) {
          result.alreadyPresent.push(key);
          inTarget.push(key);
          log(`  [have]  ${bucket}/${key}`);
        } else {
          result.conflicts.push(key);
          log(
            `  [DIFF]  ${bucket}/${key} — already in Neon at ${existingSize} bytes, ` +
              `${size} on disk; left alone`,
          );
        }
        continue;
      }

      const body = await fs.readFile(path);
      const sniffed = sniffFileType(body);
      const contentType = sniffed?.mimeType ?? FALLBACK_CONTENT_TYPE;

      if (!dryRun) {
        await target.upload({ key, body, contentType });
      }
      result.copied.push(key);
      inTarget.push(key);
      log(
        `  [${dryRun ? 'plan' : 'put '}]  ${bucket}/${key} (${body.length} bytes, ${contentType})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ key, error: message });
      log(`  [FAIL]  ${key} — ${message}`);
    }
  }

  for (const key of inTarget.filter(isAvatarKey)) {
    if (!isPubliclyReadable(key)) {
      result.avatarsNotPublic.push(key);
      continue;
    }

    const suffix = `/${key}`;
    const url = target.getUrl(key);

    try {
      // Exact re-check of every candidate, because the query underneath is a
      // LIKE: a `_` in the key would otherwise match any character there and
      // repoint an unrelated user's avatar. Over-matching is harmless only
      // because this filter runs before anything is written.
      const ids = (await avatars.find(suffix))
        .filter((row) => row.avatar.endsWith(suffix) && row.avatar !== url)
        .map((row) => row.id);
      const changed = ids.length === 0 ? 0 : dryRun ? ids.length : await avatars.update(ids, url);
      result.avatarRowsUpdated += changed;
      if (changed > 0) {
        log(`  [user]  ${dryRun ? 'would point' : 'pointed'} ${changed} avatar(s) at ${url}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ key, error: `avatar rewrite: ${message}` });
      log(`  [FAIL]  avatar rewrite for ${key} — ${message}`);
    }
  }

  const line = (label: string, value: string | number): void => log(`${label.padEnd(24)}${value}`);

  log('');
  line(`${verb}:`, result.copied.length);
  line('already in Neon:', result.alreadyPresent.length);
  line(`avatar rows ${dryRun ? 'to update' : 'updated'}:`, result.avatarRowsUpdated);
  if (result.conflicts.length) line('size conflicts:', `${result.conflicts.length} (left alone)`);
  if (result.unsafe.length) line('skipped, invalid key:', result.unsafe.length);
  if (result.avatarsNotPublic.length) {
    line(
      'avatars NOT repointed:',
      `${result.avatarsNotPublic.length} — their Neon URL would need a signature. Set ` +
        'STORAGE_NEON_PUBLIC_BUCKET (and keep `avatars` in STORAGE_NEON_PUBLIC_PREFIXES), then re-run.',
    );
  }
  if (result.failed.length) line('FAILED:', result.failed.length);

  return result;
}

const isNotFound = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

async function main(): Promise<number> {
  // A literal `--` (from `pnpm storage:migrate-local -- --dry-run`) is not an argument.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const known = ['--dry-run', '--only-if-neon'];
  const unknown = args.filter((arg) => !known.includes(arg));
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}\nUsage: [--dry-run] [--only-if-neon]`);
    return 2;
  }
  const dryRun = args.includes('--dry-run');
  // For the deploy workflow, which runs this after every deploy: an
  // environment still on another driver has nothing to migrate INTO, so that
  // is a no-op rather than an error.
  const onlyIfNeon = args.includes('--only-if-neon');

  // The app's own file, with the app's precedence: Nest's ConfigModule reads
  // .env only and never overrides an already-exported variable, and neither
  // does loadEnvFile.
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  try {
    validateEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const storage = configuration().storage;
  if (storage.driver !== 'neon' && onlyIfNeon) {
    console.log(`STORAGE_DRIVER is '${storage.driver}', not 'neon' - nothing to migrate.`);
    return 0;
  }
  if (storage.driver !== 'neon') {
    console.error(
      `STORAGE_DRIVER is '${storage.driver}'. This copies local files INTO Neon, so it needs ` +
        'STORAGE_DRIVER=neon and the Neon settings in .env — run it after a deploy that sets them.',
    );
    return 1;
  }

  const root = resolve(storage.local.root);
  if (!existsSync(root)) {
    console.log(`Nothing to migrate: ${root} does not exist.`);
    return 0;
  }

  const { neon } = storage;
  const client = new S3Client({
    region: neon.region,
    endpoint: neon.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: neon.accessKeyId, secretAccessKey: neon.secretAccessKey },
  });
  // Built exactly as StorageModule builds it, sharing this client, so routing
  // and URLs are the app's own.
  const provider = new S3CompatibleStorageProvider({
    endpoint: neon.endpoint,
    region: neon.region,
    bucket: neon.bucket,
    accessKeyId: neon.accessKeyId,
    secretAccessKey: neon.secretAccessKey,
    forcePathStyle: true,
    publicBaseUrl: storage.publicBaseUrl,
    publicBucket: neon.publicBucket,
    publicKeyPrefixes: neon.publicKeyPrefixes,
    providerName: 'neon',
    client,
  });

  const prisma = new PrismaClient(buildPrismaClientConfig().options);

  console.log(
    `${dryRun ? 'DRY RUN — nothing will be written.\n' : ''}` +
      `Migrating ${root} into Neon (private: ${neon.bucket}, public: ${neon.publicBucket ?? 'none'})\n`,
  );

  try {
    const result = await migrateLocalStorage({
      root,
      target: provider,
      dryRun,
      headObject: async (bucket, key) => {
        try {
          const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          return head.ContentLength ?? 0;
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },
      isPubliclyReadable: (key) =>
        Boolean(storage.publicBaseUrl) ||
        (neon.publicBucket !== undefined && provider.bucketFor(key) === neon.publicBucket),
      avatars: {
        find: async (suffix) =>
          (
            await prisma.user.findMany({
              where: { avatar: { endsWith: suffix } },
              select: { id: true, avatar: true },
            })
          ).flatMap((row) => (row.avatar === null ? [] : [{ id: row.id, avatar: row.avatar }])),
        update: async (ids, url) =>
          (await prisma.user.updateMany({ where: { id: { in: ids } }, data: { avatar: url } }))
            .count,
      },
    });

    const failed = result.failed.length + result.conflicts.length;
    if (failed === 0 && !dryRun) {
      console.log(
        `\nDone. Local files under ${root} were left in place; delete them once the app is verified.`,
      );
    }
    return failed === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exit(1);
    },
  );
}
