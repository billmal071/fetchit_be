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
import { config as loadEnv } from 'dotenv';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// `neon env pull` writes .env when that file exists and .env.local otherwise,
// so both are loaded. dotenv never overwrites an already-set variable, so the
// first file to define a name wins and real environment variables beat both.
loadEnv({ path: ['.env.local', '.env'] });

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
  const missing = [
    'AWS_ENDPOINT_URL_S3',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ].filter((name) => !process.env[name]);

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
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }),
  );
  console.log(`  [put]  ${bucket}/${key}`);

  try {
    await check(key);
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`  [del]  cleaned up`);
  }
}

function unsignedUrl(bucket: string, key: string): string {
  const base = (process.env.AWS_ENDPOINT_URL_S3 ?? '').replace(/\/+$/, '');

  // Path-style, which is all Neon supports — and the same address getUrl()
  // builds, so this tests what the API actually hands to clients.
  return `${base}/${bucket}/${key}`;
}

async function main(): Promise<void> {
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
