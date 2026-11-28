import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS } from '@common/constants';
import { FEATURE_FLAG_CACHE_TTL_MS, FeatureFlagService } from './feature-flag.service';

const row = (key: string, enabled = true, allowedRoles: UserRole[] = []) => ({
  key,
  enabled,
  allowedRoles,
  description: `${key} description`,
  updatedAt: new Date('2026-11-27T10:00:00Z'),
  updatedBy: null,
});

describe('feature flag keys', () => {
  it('has one seeded row in the migration for every key in the code constant, and no extras', () => {
    const sql = readFileSync(
      join(__dirname, '../../../prisma/migrations/20261127130000_add_feature_flags/migration.sql'),
      'utf8',
    );
    const seeded = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*true,\s*'\{\}'/gm)].map((m) => m[1]);
    expect([...seeded].sort()).toEqual([...FEATURE_FLAG_KEYS].sort());
  });

  it('are snake_case strings short enough for the column', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(key).toMatch(/^[a-z][a-z_]*$/);
      expect(key.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('FeatureFlagService', () => {
  let repo: { list: jest.Mock };
  let service: FeatureFlagService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  const KEY = FEATURE_FLAGS.SHOPPER_MARKETPLACE;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-27T10:00:00Z') });
    repo = { list: jest.fn(async () => [row(KEY)]) };
    service = new FeatureFlagService(repo as never);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
    error.mockRestore();
  });

  describe('who is let in', () => {
    it('lets everyone in when enabled with no role list', async () => {
      for (const role of Object.values(UserRole)) {
        expect(await service.isEnabledFor(KEY, role)).toBe(true);
      }
    });

    it('keeps everyone but ADMIN out when disabled', async () => {
      repo.list.mockResolvedValue([row(KEY, false)]);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.PERSONAL_SHOPPER)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.HANDYMAN)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.ADMIN)).toBe(true);
    });

    it('lets only the listed roles in when a list is set, and ADMIN always', async () => {
      repo.list.mockResolvedValue([row(KEY, true, [UserRole.PERSONAL_SHOPPER])]);
      expect(await service.isEnabledFor(KEY, UserRole.PERSONAL_SHOPPER)).toBe(true);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.HANDYMAN)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.ADMIN)).toBe(true);
    });

    it('a role list on a DISABLED flag does not switch it on', async () => {
      repo.list.mockResolvedValue([row(KEY, false, [UserRole.CUSTOMER])]);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
    });

    it('fails CLOSED for a key with no row, and says so once per key', async () => {
      repo.list.mockResolvedValue([]);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(await service.isEnabledFor(FEATURE_FLAGS.SHOPPER_ORDERS, UserRole.CUSTOMER)).toBe(
        false,
      );
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain(KEY);
      expect(await service.isEnabledFor(KEY, UserRole.ADMIN)).toBe(true); // staff can still test
    });

    it('evaluates every known flag for a role, as booleans only', async () => {
      repo.list.mockResolvedValue([
        row(FEATURE_FLAGS.SHOPPER_MARKETPLACE),
        row(FEATURE_FLAGS.SHOPPER_ORDERS, false),
        row(FEATURE_FLAGS.HANDYMAN_APPLICATION_FLOWS, true, [UserRole.HANDYMAN]),
      ]);
      expect(await service.evaluateAll(UserRole.CUSTOMER)).toEqual({
        shopper_marketplace: true,
        shopper_orders: false,
        handyman_application_flows: false,
      });
      expect(await service.evaluateAll(UserRole.HANDYMAN)).toEqual({
        shopper_marketplace: true,
        shopper_orders: false,
        handyman_application_flows: true,
      });
      expect(await service.evaluateAll(UserRole.ADMIN)).toEqual({
        shopper_marketplace: true,
        shopper_orders: true,
        handyman_application_flows: true,
      });
    });
  });

  describe('the cache', () => {
    it('reads the table once within the TTL, and again after it', async () => {
      await service.isEnabledFor(KEY, UserRole.CUSTOMER);
      await service.isEnabledFor(KEY, UserRole.CUSTOMER);
      jest.advanceTimersByTime(FEATURE_FLAG_CACHE_TTL_MS - 1);
      await service.isEnabledFor(KEY, UserRole.CUSTOMER);
      expect(repo.list).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2);
      await service.isEnabledFor(KEY, UserRole.CUSTOMER);
      expect(repo.list).toHaveBeenCalledTimes(2);
    });

    it('has a short TTL (10 s)', () => {
      expect(FEATURE_FLAG_CACHE_TTL_MS).toBe(10_000);
    });

    it('a change in the table is seen after the TTL by an instance that did not make it', async () => {
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(true);
      repo.list.mockResolvedValue([row(KEY, false)]); // another process flipped it
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(true); // still cached
      jest.advanceTimersByTime(FEATURE_FLAG_CACHE_TTL_MS + 1);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
    });

    it('invalidate() makes the very next call read the table', async () => {
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(true);
      repo.list.mockResolvedValue([row(KEY, false)]);
      service.invalidate();
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(repo.list).toHaveBeenCalledTimes(2);
    });

    it('shares one read between concurrent callers', async () => {
      let release!: () => void;
      repo.list.mockImplementation(
        () => new Promise((resolve) => (release = () => resolve([row(KEY)]))),
      );
      const calls = Promise.all([
        service.isEnabledFor(KEY, UserRole.CUSTOMER),
        service.isEnabledFor(KEY, UserRole.CUSTOMER),
        service.evaluateAll(UserRole.CUSTOMER),
      ]);
      await Promise.resolve();
      release();
      await calls;
      expect(repo.list).toHaveBeenCalledTimes(1);
    });

    it('does not let an invalidation that arrives mid-read be overwritten by the older read', async () => {
      let release!: (rows: ReturnType<typeof row>[]) => void;
      repo.list.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
      const stale = service.isEnabledFor(KEY, UserRole.CUSTOMER);
      await Promise.resolve();
      service.invalidate(); // an admin edit lands while the first read is in flight
      repo.list.mockResolvedValue([row(KEY, false)]);
      release([row(KEY, true)]); // the in-flight read returns the pre-edit value
      await stale;
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
    });
  });

  describe('when the table cannot be read', () => {
    it('serves the stale cache and logs, instead of failing every request', async () => {
      await service.isEnabledFor(KEY, UserRole.CUSTOMER);
      repo.list.mockRejectedValue(new Error('db down'));
      jest.advanceTimersByTime(FEATURE_FLAG_CACHE_TTL_MS + 1);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(true);
      expect(error).toHaveBeenCalled();
    });

    it('with nothing cached, fails closed for non-admins and still lets ADMIN in', async () => {
      repo.list.mockRejectedValue(new Error('db down'));
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.ADMIN)).toBe(true);
      expect(error).toHaveBeenCalled();
    });

    it('recovers on the next call once the table is readable again', async () => {
      repo.list.mockRejectedValueOnce(new Error('db down'));
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(false);
      expect(await service.isEnabledFor(KEY, UserRole.CUSTOMER)).toBe(true);
    });

    it('does not report a missing row while the table is merely unreadable', async () => {
      repo.list.mockRejectedValue(new Error('db down'));
      await service.isEnabledFor(KEY, UserRole.CUSTOMER);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
