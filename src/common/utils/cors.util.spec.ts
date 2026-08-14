import { parseCorsOrigins } from './cors.util';

/** Mirrors how the `cors` package tests a configured origin against a request. */
const allows = (origins: (string | RegExp)[], origin: string): boolean =>
  origins.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));

describe('parseCorsOrigins', () => {
  describe('defaults and parsing', () => {
    it('falls back to localhost when unset or empty', () => {
      expect(parseCorsOrigins()).toEqual(['http://localhost:3000']);
      expect(parseCorsOrigins('')).toEqual(['http://localhost:3000']);
    });

    it('splits on commas and trims surrounding whitespace', () => {
      expect(parseCorsOrigins(' https://a.com , https://b.com ')).toEqual([
        'https://a.com',
        'https://b.com',
      ]);
    });

    it('ignores empty entries from trailing or doubled commas', () => {
      expect(parseCorsOrigins('https://a.com,,https://b.com,')).toEqual([
        'https://a.com',
        'https://b.com',
      ]);
    });

    it('preserves an explicit port', () => {
      expect(parseCorsOrigins('http://localhost:4200')).toEqual(['http://localhost:4200']);
    });

    it('normalises a trailing slash and uppercase host to the Origin header form', () => {
      expect(parseCorsOrigins('https://API.Fetchit.com.ng/')).toEqual([
        'https://api.fetchit.com.ng',
      ]);
    });
  });

  describe('malformed entries are dropped, not thrown', () => {
    it.each([
      ['not-a-url'],
      ['://missing-scheme.com'],
      ['ftp://files.example.com'],
      ['javascript:alert(1)'],
      ['https://user:pass@example.com'],
      ['https://example.com/some/path'],
      ['https://example.com?q=1'],
    ])('drops %s', (entry) => {
      expect(parseCorsOrigins(entry)).toEqual([]);
    });

    it('keeps the valid entries alongside a malformed one', () => {
      expect(parseCorsOrigins('https://good.com,not-a-url,https://also-good.com')).toEqual([
        'https://good.com',
        'https://also-good.com',
      ]);
    });
  });

  describe('subdomain wildcards', () => {
    const origins = parseCorsOrigins('https://*.fetchit.com.ng');

    it('matches a single subdomain label', () => {
      expect(allows(origins, 'https://dev.fetchit.com.ng')).toBe(true);
    });

    it('matches nested subdomain labels', () => {
      expect(allows(origins, 'https://dev.api.fetchit.com.ng')).toBe(true);
    });

    it('does not match the apex domain', () => {
      expect(allows(origins, 'https://fetchit.com.ng')).toBe(false);
    });

    it('does not match a different scheme', () => {
      expect(allows(origins, 'http://dev.fetchit.com.ng')).toBe(false);
    });

    it('does not match a lookalike domain that merely ends with the suffix', () => {
      expect(allows(origins, 'https://evil-fetchit.com.ng')).toBe(false);
      expect(allows(origins, 'https://dev.notfetchit.com.ng')).toBe(false);
    });

    it('does not let the wildcard escape the host into a path', () => {
      expect(allows(origins, 'https://evil.com/dev.fetchit.com.ng')).toBe(false);
    });

    it('is anchored at both ends', () => {
      expect(allows(origins, 'https://dev.fetchit.com.ng.evil.com')).toBe(false);
      expect(allows(origins, 'prefix-https://dev.fetchit.com.ng')).toBe(false);
    });

    it('pairs with an explicit apex entry to cover both', () => {
      const both = parseCorsOrigins('https://fetchit.com.ng,https://*.fetchit.com.ng');
      expect(allows(both, 'https://fetchit.com.ng')).toBe(true);
      expect(allows(both, 'https://dev.fetchit.com.ng')).toBe(true);
    });

    it('respects a port on a wildcard entry', () => {
      const withPort = parseCorsOrigins('http://*.localhost.test:3000');
      expect(allows(withPort, 'http://a.localhost.test:3000')).toBe(true);
      expect(allows(withPort, 'http://a.localhost.test:4000')).toBe(false);
    });
  });

  describe('overly broad wildcards are rejected', () => {
    it.each([
      ['https://*', 'https://anything.com'],
      ['https://*.com', 'https://evil.com'],
      ['https://api.*.com', 'https://api.evil.com'],
      ['*', 'https://anything.com'],
    ])('drops %s so it cannot match %s', (entry, probe) => {
      const origins = parseCorsOrigins(entry);
      expect(origins).toEqual([]);
      expect(allows(origins, probe)).toBe(false);
    });
  });

  describe('regex metacharacters in the host are treated literally', () => {
    it('does not let a dot match an arbitrary character', () => {
      const origins = parseCorsOrigins('https://*.fetchit.com.ng');
      expect(allows(origins, 'https://dev.fetchitXcom.ng')).toBe(false);
    });
  });
});
