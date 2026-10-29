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
import 'dotenv/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Must match a bucket declared in neon.ts, which is what `neon deploy`
// creates. Overridable so this can be pointed at another branch's bucket.
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
        '`neon env pull` (or `neon-env run -- pnpm neon:smoke`) first.',
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

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 3600,
  });
  console.log(`[view] ${url}`);

  // The actual end-to-end proof: fetch the presigned URL over plain HTTP, with
  // no credentials in play, and check the bytes survived the round trip.
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

  // Confirms the signature is genuinely scoped: strip the query string and the
  // same object must NOT be readable, or the bucket is not private.
  const unsigned = await fetch(url.split('?')[0]);
  console.log(
    unsigned.ok
      ? `[warn] object is readable WITHOUT a signature (HTTP ${unsigned.status}) — bucket is public_read`
      : `[priv] ok — unsigned read refused (HTTP ${unsigned.status})`,
  );

  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log('[del]  ok — bucket left as found');
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
