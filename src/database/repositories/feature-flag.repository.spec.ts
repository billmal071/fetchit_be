import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { FeatureFlagRepository } from './feature-flag.repository';

const ROW = {
  key: 'shopper_orders',
  enabled: true,
  allowedRoles: [] as UserRole[],
  description: 'Orders',
  updatedAt: new Date('2026-11-27T10:00:00Z'),
  updatedById: null,
  updatedBy: null,
};

const make = (row: typeof ROW | null = ROW) => {
  const order: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => {
      order.push('lock');
      return [{ key: 'shopper_orders' }];
    }),
    featureFlag: {
      findUnique: jest.fn(async () => {
        order.push('read');
        return row;
      }),
      update: jest.fn(async ({ data }: { data: object }) => {
        order.push('write');
        return { ...ROW, ...data, updatedBy: { id: 'admin-1', username: 'ada' } };
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    featureFlag: { findMany: jest.fn(async () => [ROW]) },
  };
  return { tx, prisma, order, repo: new FeatureFlagRepository(prisma as unknown as PrismaService) };
};

describe('FeatureFlagRepository', () => {
  it('lists flags ordered by key with the editor', async () => {
    const { prisma, repo } = make();
    expect(await repo.list()).toEqual([
      {
        key: 'shopper_orders',
        description: 'Orders',
        enabled: true,
        allowedRoles: [],
        updatedAt: ROW.updatedAt,
        updatedBy: null,
      },
    ]);
    expect(prisma.featureFlag.findMany).toHaveBeenCalledWith({
      include: { updatedBy: { select: { id: true, username: true } } },
      orderBy: { key: 'asc' },
    });
  });

  describe('update', () => {
    it('locks the row before reading it, then writes', async () => {
      const { order, repo } = make();
      await repo.update('shopper_orders', { enabled: false }, 'admin-1');
      expect(order).toEqual(['lock', 'read', 'write']);
    });

    it('is not_found for a missing key and writes nothing', async () => {
      const { tx, repo } = make(null);
      expect(await repo.update('nope', { enabled: false }, 'admin-1')).toEqual({
        outcome: 'not_found',
      });
      expect(tx.featureFlag.update).not.toHaveBeenCalled();
    });

    it('writes only changed fields plus the editor, reporting before and after', async () => {
      const { tx, repo } = make({ ...ROW, allowedRoles: [UserRole.CUSTOMER] });
      const result = await repo.update(
        'shopper_orders',
        { enabled: false, allowedRoles: [UserRole.CUSTOMER] },
        'admin-1',
      );
      expect(tx.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { enabled: false, updatedById: 'admin-1' } }),
      );
      expect(result).toMatchObject({
        outcome: 'updated',
        before: { enabled: true },
        after: { enabled: false },
        record: { enabled: false, updatedBy: { id: 'admin-1', username: 'ada' } },
      });
    });

    it('runs the hook with the transaction client after the write, and only then', async () => {
      const { tx, order, repo } = make();
      const hook = jest.fn(async () => {
        order.push('hook');
      });
      await repo.update('shopper_orders', { enabled: false }, 'admin-1', hook);
      expect(hook).toHaveBeenCalledWith(tx, {
        before: { enabled: true },
        after: { enabled: false },
      });
      expect(order).toEqual(['lock', 'read', 'write', 'hook']);
    });

    it('lets a failing hook reject the update (so the transaction rolls back)', async () => {
      const { repo } = make();
      await expect(
        repo.update('shopper_orders', { enabled: false }, 'admin-1', async () => {
          throw new Error('audit down');
        }),
      ).rejects.toThrow('audit down');
    });

    it('never runs the hook for a no-op or an unknown key', async () => {
      const hook = jest.fn();
      await make().repo.update('shopper_orders', { enabled: true }, 'a', hook);
      await make(null).repo.update('nope', { enabled: true }, 'a', hook);
      expect(hook).not.toHaveBeenCalled();
    });

    it('is unchanged (no write) when values equal the stored ones', async () => {
      const { tx, repo } = make();
      const result = await repo.update(
        'shopper_orders',
        { enabled: true, allowedRoles: [] },
        'admin-1',
      );
      expect(result.outcome).toBe('unchanged');
      expect(tx.featureFlag.update).not.toHaveBeenCalled();
    });

    it('compares role lists as sets and stores them sorted', async () => {
      const stored = [UserRole.CUSTOMER, UserRole.HANDYMAN];
      const same = make({ ...ROW, allowedRoles: stored });
      expect(
        (
          await same.repo.update(
            'shopper_orders',
            { allowedRoles: [UserRole.HANDYMAN, UserRole.CUSTOMER] },
            'a',
          )
        ).outcome,
      ).toBe('unchanged');

      const diff = make();
      const result = await diff.repo.update(
        'shopper_orders',
        { allowedRoles: [UserRole.HANDYMAN, UserRole.CUSTOMER, UserRole.HANDYMAN] },
        'a',
      );
      expect(diff.tx.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { allowedRoles: [UserRole.CUSTOMER, UserRole.HANDYMAN], updatedById: 'a' },
        }),
      );
      expect(result).toMatchObject({ outcome: 'updated', before: { allowedRoles: [] } });
    });
  });
});
