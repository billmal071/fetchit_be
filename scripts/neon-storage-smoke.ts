/**
 * Neon Object Storage end-to-end smoke test.
 *
 * Proves the two-bucket split actually behaves as the driver claims, which is
 * the security property the `neon` driver rests on and the one thing unit
 * tests cannot show:
 *
 *   private bucket   signed read succeeds, UNSIGNED read is refused
 *   public bucket    unsigned read succeeds
 *
 * A write that succeeds and a URL that prints prove neither of those, so each
 * is fetched over plain HTTP and the bytes compared.
 *
 * Run it after `neon deploy` && `neon env pull`:
 *
 *   pnpm neon:smoke
 *
 * It reads the AWS-standard names the Neon CLI injects. They are branch-scoped,
 * so this always tests whichever branch `.env.local` / `.env` points at.
 *
 * Every object it writes goes under a `smoke/` segment inside the relevant
 * prefix and is deleted in a `finally`, so a failed run leaves nothing behind.
 * Deliberately not part of `pnpm test`: that suite must stay runnable with no
 * credentials and no network.
 */
/* eslint-disable no-console -- standalone CLI script: stdout is its interface */
import { existsSync, readFileSync } from 'fs';
import { config as loadEnv, parse as parseEnvFile } from 'dotenv';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// `.env` FIRST, because that is the only file the app reads — Nest's
// ConfigModule.forRoot() sets no envFilePath. If this script preferred
// .env.local it could pass against a different Neon branch than the app is
// actually talking to, which is worse than failing. `.env.local` stays as a
// fallback because `neon env pull` writes there when no `.env` exists.
//
// dotenv never overwrites an already-set variable, so the first file to define
// a name wins and real environment variables beat both files.
loadEnv({ path: ['.env', '.env.local'] });

/** The AWS-standard names the Neon CLI injects and the driver signs with. */
const NEON_CREDENTIAL_NAMES = [
  'AWS_ENDPOINT_URL_S3',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

/**
 * `.env` is the only file the app reads, so a credential that exists ONLY in
 * `.env.local` is one this script would sign with and the app would boot
 * without. The run would PASS while the app failed validation at startup —
 * a green result for a configuration that cannot work, which is the one
 * outcome this script must never produce. So it fails rather than warns.
 *
 * Different VALUES for the same name are only a warning: `.env` wins here and
 * `.env` is what the app reads, so the branch under test is the right one and
 * the stale `.env.local` is just worth pointing out.
 */
function checkEnvFileAgreement(): void {
  if (!existsSync('.env') || !existsSync('.env.local')) {
    return;
  }

  const primary = parseEnvFile(readFileSync('.env'));
  const fallback = parseEnvFile(readFileSync('.env.local'));

  const fallbackOnly = NEON_CREDENTIAL_NAMES.filter(
    (name) =>
      !String(primary[name] ?? '').trim() &&
      String(fallback[name] ?? '').trim() &&
      // A real environment variable beats both files for the app too, so a
      // file-level gap behind it is not misleading.
      !hasRealEnvOverride(name, primary, fallback),
  );

  if (fallbackOnly.length > 0) {
    throw new Error(
      `${fallbackOnly.join(', ')} ${fallbackOnly.length === 1 ? 'is' : 'are'} set in .env.local ` +
        'but missing from .env, which is the only env file the app reads ' +
        '(ConfigModule.forRoot() sets no envFilePath). This script would pass using ' +
        '.env.local while the app failed its own validation at boot.\n' +
        'Copy the value into .env (or re-run `neon env pull` with .env in place), or delete ' +
        '.env.local so there is one source of truth.',
    );
  }

  const divergent = Object.keys(fallback).filter(
    (name) =>
      name.startsWith('AWS_') && primary[name] !== undefined && primary[name] !== fallback[name],
  );

  if (divergent.length > 0) {
    console.warn(
      `[warn] .env and .env.local disagree on ${divergent.join(', ')}. Using .env, which is ` +
        'the only file the app reads — so .env.local may describe a different Neon branch.\n',
    );
  }
}

/**
 * A variable exported in the real environment overrides both files for this
 * script AND for the app, so a file-level gap behind it is not misleading.
 * Detected by the value in `process.env` matching neither file, since dotenv
 * leaves an already-set variable alone.
 */
function hasRealEnvOverride(
  name: string,
  primary: Record<string, string>,
  fallback: Record<string, string>,
): boolean {
  const live = process.env[name];
  return Boolean(live) && live !== primary[name] && live !== fallback[name];
}

/** Buckets must match what neon.ts declares and `neon deploy` created. */
const privateBucket = process.env.STORAGE_NEON_BUCKET || 'fetchit-uploads';
const publicBucket = process.env.STORAGE_NEON_PUBLIC_BUCKET;
const publicPrefixes = (process.env.STORAGE_NEON_PUBLIC_PREFIXES ?? 'avatars,receipts')
  .split(',')
  .map((prefix) => prefix.trim())
  .filter(Boolean);

const body = 'Hello World!';
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Fail with a readable message rather than letting the SDK report a vague
 * signing error several calls later.
 */
function requireEnv(): void {
  const missing = NEON_CREDENTIAL_NAMES.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}.\n` +
        'These are injected by the Neon CLI — run `neon deploy` then ' +
        '`neon env pull`, which writes .env (if it exists) or .env.local; both ' +
        'are read here. Or skip the file entirely with ' +
        '`neon-env run -- pnpm neon:smoke`.\n' +
        'If the file does contain them, check `env | grep ^AWS_`: a real ' +
        'environment variable overrides the file.',
    );
  }
}

/** Fetch over plain HTTP and confirm the bytes survived the round trip. */
async function expectReadable(url: string, label: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}: expected a readable object, got HTTP ${response.status}`);
  }

  const roundTripped = await response.text();
  if (roundTripped !== body) {
    throw new Error(
      `${label}: content mismatch — sent ${JSON.stringify(body)}, got ${JSON.stringify(roundTripped)}`,
    );
  }
  console.log(`  [ok]   ${label} — ${roundTripped.length} bytes match`);
}

/**
 * Only an authorization denial proves privacy. Treating any non-2xx as "refused"
 * would let a transient 503 report a public bucket as private, which is the one
 * direction of this check that must never produce a false pass.
 */
async function expectRefused(url: string, label: string): Promise<void> {
  const response = await fetch(url);

  if (response.ok) {
    throw new Error(
      `${label}: object is readable WITHOUT a signature (HTTP ${response.status}) — ` +
        'this bucket is NOT private',
    );
  }
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(
      `${label}: HTTP ${response.status} is not an authorization denial; privacy unverified`,
    );
  }
  console.log(`  [ok]   ${label} — refused (HTTP ${response.status})`);
}

/** PUT an object, run `check` against it, then always delete it. */
async function withObject(
  s3: S3Client,
  bucket: string,
  key: string,
  check: (key: string) => Promise<void>,
): Promise<void> {
  // The PUT is INSIDE the try: if it commits server-side but the response is
  // lost (timeout, reset), it rejects here while the object exists, and
  // cleanup still has to run.
  try {
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }),
    );
    console.log(`  [put]  ${bucket}/${key}`);

    await check(key);
  } finally {
    // Never let a cleanup failure replace the real error: a delete of a key
    // the PUT never created is expected to fail, and that must not become the
    // reported cause.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`  [del]  cleaned up`);
    } catch (cleanupError) {
      console.warn(
        `  [warn] could not delete ${bucket}/${key}: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }
  }
}

function unsignedUrl(bucket: string, key: string): string {
  const base = (process.env.AWS_ENDPOINT_URL_S3 ?? '').replace(/\/+$/, '');

  // Path-style, which is all Neon supports — and the same address getUrl()
  // builds, so this tests what the API actually hands to clients.
  return `${base}/${bucket}/${key}`;
}

async function main(): Promise<void> {
  checkEnvFileAgreement();
  requireEnv();

  // forcePathStyle is required: Neon Object Storage supports path-style
  // addressing only. Endpoint, region and credentials come from the standard
  // AWS env chain, so nothing else needs passing.
  const s3 = new S3Client({ forcePathStyle: true });

  console.log(`endpoint       ${process.env.AWS_ENDPOINT_URL_S3}`);
  console.log(`region         ${process.env.AWS_REGION}`);
  console.log(`private bucket ${privateBucket}`);
  console.log(`public bucket  ${publicBucket ?? '(none configured)'}`);
  console.log(`public prefixes ${publicPrefixes.join(', ') || '(none)'}\n`);

  // --- private bucket: signed reads work, unsigned reads must not -----------
  console.log(`private bucket (${privateBucket}) — KYC documents live here`);
  await withObject(s3, privateBucket, `handyman-documents/smoke/${runId}.txt`, async (key) => {
    const signed = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: privateBucket, Key: key }),
      { expiresIn: 3600 },
    );
    await expectReadable(signed, 'signed read');
    await expectRefused(unsignedUrl(privateBucket, key), 'unsigned read');
  });

  // --- public bucket: unsigned reads must work ------------------------------
  if (!publicBucket) {
    console.log(
      '\npublic bucket — SKIPPED: STORAGE_NEON_PUBLIC_BUCKET is unset, so avatars and\n' +
        'receipts go to the private bucket and POST /uploads returns a URL that 403s.',
    );
    console.log('\nPASS (private bucket only)');
    return;
  }

  const publicPrefix = publicPrefixes[0];
  if (!publicPrefix) {
    throw new Error(
      'STORAGE_NEON_PUBLIC_BUCKET is set but STORAGE_NEON_PUBLIC_PREFIXES is empty, ' +
        'so no key would ever route to it.',
    );
  }

  console.log(`\npublic bucket (${publicBucket}) — avatars and receipts live here`);
  await withObject(s3, publicBucket, `${publicPrefix}/smoke/${runId}.txt`, async (key) =>
    // The whole point of this bucket: a plain URL a client can persist.
    expectReadable(unsignedUrl(publicBucket, key), 'unsigned read'),
  );

  console.log('\nPASS — private bucket refuses unsigned reads, public bucket allows them');
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
