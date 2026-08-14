/**
 * Parses the CORS_ORIGINS environment variable into the value expected by
 * `app.enableCors({ origin })`.
 *
 * Entries are comma-separated and may be either:
 *   - an exact origin, e.g. `https://fetchit.com.ng`
 *   - a subdomain wildcard, e.g. `https://*.fetchit.com.ng`
 *
 * A wildcard matches one or more subdomain labels, so `https://*.fetchit.com.ng`
 * covers both `dev.fetchit.com.ng` and `dev.api.fetchit.com.ng`. It does NOT
 * cover the apex domain — list `https://fetchit.com.ng` separately if you need it.
 *
 * Malformed entries are dropped rather than throwing, so one bad value in the
 * environment cannot stop the app from booting. Because a dropped entry means a
 * browser origin silently loses access, callers should log the result.
 */

/** Matches one or more DNS labels: `dev` or `dev.api`. */
const SUBDOMAIN_PATTERN = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*';

/**
 * Stand-in for `*` so a wildcard entry can be validated with the URL parser.
 * Must be a syntactically valid DNS label and something no real host contains.
 */
const WILDCARD_PLACEHOLDER = 'wildcard-placeholder';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses a value that must be a bare origin — scheme, host, optional port and
 * nothing else. Returns null for anything else, including paths, credentials,
 * query strings and non-HTTP schemes.
 */
function parseOrigin(value: string): URL | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;

  return url;
}

export function parseCorsOrigins(raw?: string): (string | RegExp)[] {
  const entries = (raw || 'http://localhost:3000')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const origins: (string | RegExp)[] = [];

  for (const entry of entries) {
    if (!entry.includes('*')) {
      const url = parseOrigin(entry);
      // `url.origin` normalises case and drops any trailing slash, so the value
      // compares cleanly against the browser's Origin header.
      if (url) origins.push(url.origin);
      continue;
    }

    const url = parseOrigin(entry.replace(/\*/g, WILDCARD_PLACEHOLDER));
    if (!url) continue;

    // The wildcard is only honoured as a leading subdomain label. This rejects
    // `https://*` and `https://*.com`, which would otherwise match nearly every
    // origin on the internet, as well as mid-host wildcards like
    // `https://api.*.com` that read as narrower than they are.
    if (!url.hostname.startsWith(`${WILDCARD_PLACEHOLDER}.`)) continue;

    const suffix = url.hostname.slice(WILDCARD_PLACEHOLDER.length + 1);
    if (suffix.includes(WILDCARD_PLACEHOLDER)) continue; // more than one wildcard
    if (!suffix.includes('.')) continue; // require a registrable domain

    const port = url.port ? `:${escapeRegExp(url.port)}` : '';
    origins.push(
      new RegExp(
        `^${escapeRegExp(url.protocol)}//${SUBDOMAIN_PATTERN}\\.${escapeRegExp(suffix)}${port}$`,
        'i',
      ),
    );
  }

  return origins;
}
