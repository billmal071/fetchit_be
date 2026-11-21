import { isIP } from 'net';

/**
 * SSRF guard for Web Push endpoints. The server POSTs to whatever endpoint a
 * client registers, so only known push-service hosts over https are allowed.
 * Entries starting with '.' are suffix matches; others are exact hostnames.
 */
export const DEFAULT_PUSH_ALLOWED_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.apple.com',
];

/** Parses the comma-separated PUSH_ALLOWED_HOSTS value; empty means "use defaults". */
export function parseAllowedHosts(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

/** Valid entry: hostname or '.suffix' with at least two labels; never an IP literal. */
export function isValidAllowedHostEntry(entry: string): boolean {
  const host = entry.startsWith('.') ? entry.slice(1) : entry;
  if (isIP(host) !== 0 || host.includes(':')) return false;
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(
    host,
  );
}

export function isAllowedPushEndpoint(
  endpoint: string,
  extraHosts: readonly string[] = [],
): boolean {
  // Backslashes are treated as '/' by WHATWG URL but not by every client.
  if (typeof endpoint !== 'string' || endpoint.includes('\\')) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;

  // URL lowercases the hostname; strip one trailing dot (FQDN form).
  const hostname = url.hostname.replace(/\.$/, '');
  if (!hostname || hostname.includes(':') || hostname.startsWith('[')) return false; // IPv6
  if (isIP(hostname) !== 0) return false;
  // WHATWG normalises numeric forms such as 2130706433 to dotted quads, but be strict anyway.
  if (/^[0-9.x]+$/i.test(hostname)) return false;

  const allowed = extraHosts.length > 0 ? extraHosts : DEFAULT_PUSH_ALLOWED_HOSTS;
  return allowed.some((entry) =>
    entry.startsWith('.') ? hostname.endsWith(entry) : hostname === entry,
  );
}
