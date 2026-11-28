import { UserRole } from '@prisma/client';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import type { IFeatureFlagRecord } from '@/database/repositories';

const UPDATED_AT = new Date('2026-11-27T10:00:00.000Z');
const record = (over: Partial<IFeatureFlagRecord> = {}): IFeatureFlagRecord => ({
  key: 'shopper_orders',
  description: 'Orders',
  enabled: true,
  allowedRoles: [],
  updatedAt: UPDATED_AT,
  updatedBy: null,
  ...over,
});

const TX = { tag: 'tx' };
/** A repository that, like the real one, runs the hook inside its transaction after a write. */
const writes = (repo: { update: jest.Mock }, result: Record<string, unknown>): void => {
  repo.update.mockImplementation(async (_key, _patch, _id, hook) => {
    await hook?.(TX, { before: result.before, after: result.after });
    return result;
  });
};

describe('AdminFeatureFlagsService', () => {
  const repo = { list: jest.fn(), update: jest.fn() };
  const flags = { invalidate: jest.fn() };
  const audit = { log: jest.fn() };
  const service = new AdminFeatureFlagsService(repo as never, flags as never, audit as never);

  beforeEach(() => {
    jest.resetAllMocks();
    audit.log.mockResolvedValue(undefined);
  });

  it('lists flags with ISO timestamps and editor', async () => {
    repo.list.mockResolvedValue([record({ updatedBy: { id: 'a', username: 'ada' } })]);
    expect(await service.list()).toEqual([
      {
        key: 'shopper_orders',
        description: 'Orders',
        enabled: true,
        allowedRoles: [],
        updatedAt: '2026-11-27T10:00:00.000Z',
        updatedBy: { id: 'a', username: 'ada' },
      },
    ]);
  });

  it('rejects an empty patch with 400 before touching the repository', async () => {
    await expect(service.update('a', 'shopper_orders', {})).rejects.toMatchObject({ status: 400 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('is 404 for an unknown key, with no audit and no invalidation', async () => {
    repo.update.mockResolvedValue({ outcome: 'not_found' });
    await expect(service.update('a', 'nope', { enabled: false })).rejects.toMatchObject({
      status: 404,
    });
    expect(audit.log).not.toHaveBeenCalled();
    expect(flags.invalidate).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing changes: no audit, no invalidation', async () => {
    repo.update.mockResolvedValue({ outcome: 'unchanged', record: record() });
    const result = await service.update('a', 'shopper_orders', { enabled: true });
    expect(result.enabled).toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
    expect(flags.invalidate).not.toHaveBeenCalled();
  });

  it('invalidates the cache and audits only the changed fields', async () => {
    writes(repo, {
      outcome: 'updated',
      before: { enabled: true },
      after: { enabled: false },
      record: record({ enabled: false, updatedBy: { id: 'a', username: 'ada' } }),
    });
    const result = await service.update('a', 'shopper_orders', { enabled: false });
    expect(repo.update).toHaveBeenCalledWith(
      'shopper_orders',
      { enabled: false },
      'a',
      expect.any(Function),
    );
    expect(flags.invalidate).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      {
        userId: 'a',
        action: 'FEATURE_FLAG_UPDATED',
        entity: 'FeatureFlag',
        entityId: 'shopper_orders',
        details: { before: { enabled: true }, after: { enabled: false } },
      },
      TX, // the transaction client, not the service's own connection
    );
    expect(result.enabled).toBe(false);
  });

  it('passes role lists through and audits them', async () => {
    writes(repo, {
      outcome: 'updated',
      before: { allowedRoles: [] },
      after: { allowedRoles: [UserRole.CUSTOMER] },
      record: record({ allowedRoles: [UserRole.CUSTOMER] }),
    });
    const result = await service.update('a', 'shopper_orders', {
      allowedRoles: [UserRole.CUSTOMER],
    });
    expect(result.allowedRoles).toEqual([UserRole.CUSTOMER]);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('does NOT swallow an audit failure: it propagates (the repository rolls the edit back) and the cache is not invalidated', async () => {
    writes(repo, {
      outcome: 'updated',
      before: { enabled: true },
      after: { enabled: false },
      record: record({ enabled: false }),
    });
    audit.log.mockRejectedValue(new Error('audit down'));
    await expect(service.update('a', 'shopper_orders', { enabled: false })).rejects.toThrow(
      'audit down',
    );
    expect(flags.invalidate).not.toHaveBeenCalled();
  });
});
