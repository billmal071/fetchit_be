/**
 * Neon Object Storage end-to-end smoke test.
 *
 * Proves the configured bucket actually accepts a write and that the presigned
 * URL it hands back actually resolves — printing a URL on its own proves
 * neither. Run it after `neon deploy` && `neon env pull`:
 *
 *   pnpm neon:smoke
 *
 * It reads the AWS-standard names the Neon CLI injects. They are branch-scoped,
 * so this always tests whichever branch `.env.local` currently points at.
 *
 * Writes and then DELETES one small object under `smoke/`, so it leaves the
 * bucket as it found it. It is deliberately not part of `pnpm test`: that
 * suite must stay runnable with no credentials and no network.
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

// Must match a bucket declared in neon.ts, which is what `neon deploy`
// creates. Overridable so this can be pointed at another branch's bucket.
// `neon env pull` writes .env when that file exists and .env.local otherwise,
// so both are loaded. dotenv never overwrites an already-set variable, so the
// first file to define a name wins and real environment variables beat both.
loadEnv({ path: ['.env.local', '.env'] });

const bucket = process.env.STORAGE_NEON_BUCKET || 'fetchit-uploads';
const key = `smoke/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
const body = 'Hello World!';

/**
 * Fail with a readable message rather than letting the SDK report a vague
 * signing error several calls later.
 */
function requireEnv(): void {
  const required = [
    'AWS_ENDPOINT_URL_S3',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ];
  const missing = required.filter((name) => !process.env[name]);

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

async function main(): Promise<void> {
  requireEnv();

  // forcePathStyle is required: Neon Object Storage supports path-style
  // addressing only. Endpoint, region and credentials come from the standard
  // AWS env chain, so nothing else needs passing.
  const s3 = new S3Client({ forcePathStyle: true });

  console.log(`bucket   ${bucket}`);
  console.log(`endpoint ${process.env.AWS_ENDPOINT_URL_S3}`);
  console.log(`region   ${process.env.AWS_REGION}`);
  console.log(`key      ${key}`);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain',
    }),
  );
  console.log('[put]  ok');

  // From here on the object exists, so cleanup has to run even when a check
  // throws — otherwise every failed run leaves another object behind and the
  // "leaves the bucket as it found it" claim above stops being true.
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 3600,
    });
    console.log(`[view] ${url}`);

    // The actual end-to-end proof: fetch the presigned URL over plain HTTP,
    // with no credentials in play, and check the bytes survived the round trip.
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`presigned GET failed: HTTP ${response.status} ${response.statusText}`);
    }
    const roundTripped = await response.text();
    if (roundTripped !== body) {
      throw new Error(
        `content mismatch: sent ${JSON.stringify(body)}, got ${JSON.stringify(roundTripped)}`,
      );
    }
    console.log(`[get]  ok — ${roundTripped.length} bytes match`);

    // Confirms the signature is genuinely scoped: strip the query string and
    // the same object must NOT be readable, or the bucket is not private.
    //
    // Only an authorization denial proves that. Treating any non-2xx as "private"
    // would let a transient 503 report a public bucket as private, which is the
    // one direction of this check that must never produce a false pass.
    const unsigned = await fetch(url.split('?')[0]);
    if (unsigned.ok) {
      console.log(
        `[warn] object is readable WITHOUT a signature (HTTP ${unsigned.status}) — ` +
          'bucket is public_read',
      );
    } else if (unsigned.status === 401 || unsigned.status === 403) {
      console.log(`[priv] ok — unsigned read refused (HTTP ${unsigned.status})`);
    } else {
      throw new Error(
        `unsigned GET returned HTTP ${unsigned.status}; privacy could not be verified`,
      );
    }
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log('[del]  ok — bucket left as found');
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
