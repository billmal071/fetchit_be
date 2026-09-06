/**
 * Object keys are always server-generated, but a provider is a security
 * boundary: a key that escaped its prefix would let a caller write outside the
 * upload root (local driver) or over an unrelated object (S3). Validate the
 * shape rather than trusting the caller.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertSafeStorageKey(key: string): string {
  if (
    !key ||
    key.length > 512 ||
    !SAFE_KEY.test(key) ||
    key.includes('..') ||
    key.includes('//') ||
    key.endsWith('/')
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
  return key;
}

/**
 * Join a base URL and an object key without producing `//` or dropping a path
 * segment the way `new URL(key, base)` would.
 */
export function joinUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}
