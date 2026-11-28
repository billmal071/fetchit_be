import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ShoppingConfigRepository } from './shopping-config.repository';
import { ShoppingConfigConstraintError } from './interfaces';

const D = (n: number) => new Prisma.Decimal(n);
const ROW = {
  id: 1,
  minShopperFee: 500,
  maxShopperFee: 5000,
  deliveryFee: 1500,
  serviceChargePercent: D(5),
  vatPercent: D(7.5),
  priceBufferPercent: D(10),
  offerWindowMinutes: 30,
  shopperAcceptWindowMinutes: 30,
  offerAcceptanceWindowMinutes: 1440,
  updatedAt: new Date('2026-11-26T10:00:00Z'),
  updatedById: null,
};

const make = (row: object | null = ROW) => {
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 1 }]),
    shoppingConfig: {
      findUnique: jest.fn(async () => row),
      update: jest.fn(async ({ data }: { data: object }) => ({
        ...ROW,
        ...data,
        updatedBy: { id: 'admin-1', username: 'ada' },
      })),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    shoppingConfig: { findUnique: jest.fn(async () => row) },
  };
  return { tx, prisma, repo: new ShoppingConfigRepository(prisma as unknown as PrismaService) };
};

describe('ShoppingConfigRepository', () => {
  describe('getRecord', () => {
    it('maps decimals to plain numbers and includes who changed it', async () => {
      const { prisma, repo } = make({ ...ROW, updatedBy: { id: 'admin-1', username: 'ada' } });
      expect(await repo.getRecord()).toEqual({
        minShopperFee: 500,
        maxShopperFee: 5000,
        deliveryFee: 1500,
        serviceChargePercent: 5,
        vatPercent: 7.5,
        priceBufferPercent: 10,
        offerWindowMinutes: 30,
        shopperAcceptWindowMinutes: 30,
        offerAcceptanceWindowMinutes: 1440,
        updatedAt: ROW.updatedAt,
        updatedBy: { id: 'admin-1', username: 'ada' },
      });
      expect(prisma.shoppingConfig.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { updatedBy: { select: { id: true, username: true } } },
      });
    });

    it('is null for a missing row, and updatedBy is null when never edited', async () => {
      expect(await make(null).repo.getRecord()).toBeNull();
      expect((await make({ ...ROW, updatedBy: null }).repo.getRecord())?.updatedBy).toBeNull();
    });
  });

  describe('get', () => {
    it('reads the row fresh on every call: there is no cache to invalidate', async () => {
      const { prisma, repo } = make();
      await repo.get();
      await repo.get();
      expect(prisma.shoppingConfig.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    it('locks the singleton row FOR UPDATE before reading it', async () => {
      const { tx, repo } = make();
      await repo.update({ deliveryFee: 2000 }, 'admin-1', () => []);
      const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
      expect(sql).toMatch(/FROM shopping_config\s+WHERE id = 1\s+FOR UPDATE/);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.shoppingConfig.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('validates the MERGED result (stored values overlaid with the patch)', async () => {
      const { repo } = make();
      const validate = jest.fn(() => []);
      await repo.update({ minShopperFee: 4000 }, 'admin-1', validate);
      expect(validate).toHaveBeenCalledWith(
        expect.objectContaining({ minShopperFee: 4000, maxShopperFee: 5000, vatPercent: 7.5 }),
      );
    });

    it('writes one UPDATE with only the changed fields and the admin id, and reports before/after of those only', async () => {
      const { tx, repo } = make();
      const result = await repo.update(
        { deliveryFee: 2000, vatPercent: 7.5, minShopperFee: 500 },
        'admin-1',
        () => [],
      );
      expect(tx.shoppingConfig.update).toHaveBeenCalledTimes(1);
      expect(tx.shoppingConfig.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { deliveryFee: 2000, updatedById: 'admin-1' },
        include: { updatedBy: { select: { id: true, username: true } } },
      });
      expect(result).toMatchObject({
        outcome: 'updated',
        before: { deliveryFee: 1500 },
        after: { deliveryFee: 2000 },
      });
    });

    it('writes nothing when every field already has that value', async () => {
      const { tx, repo } = make({ ...ROW, updatedBy: null });
      expect(
        await repo.update({ deliveryFee: 1500, vatPercent: 7.5 }, 'admin-1', () => []),
      ).toMatchObject({
        outcome: 'unchanged',
      });
      expect(tx.shoppingConfig.update).not.toHaveBeenCalled();
    });

    it('writes nothing, and returns the violations, when the merged result is invalid', async () => {
      const { tx, repo } = make();
      const errors = [{ field: 'minShopperFee', message: 'too high' }];
      expect(await repo.update({ minShopperFee: 9000 }, 'admin-1', () => errors)).toEqual({
        outcome: 'invalid',
        errors,
      });
      expect(tx.shoppingConfig.update).not.toHaveBeenCalled();
    });

    it('reports a missing row', async () => {
      expect(await make(null).repo.update({ deliveryFee: 1 }, 'admin-1', () => [])).toEqual({
        outcome: 'missing',
      });
    });

    it.each([
      [
        'Prisma P2004',
        new Prisma.PrismaClientKnownRequestError('check', {
          code: 'P2004',
          clientVersion: 'x',
          meta: { database_error: 'violates check constraint "shopping_config_fee_bounds"' },
        }),
      ],
      [
        'a raw 23514',
        new Prisma.PrismaClientKnownRequestError('check', {
          code: 'P2010',
          clientVersion: 'x',
          meta: { code: '23514', message: 'violates check constraint' },
        }),
      ],
    ])(
      'maps a database CHECK violation (%s) to ShoppingConfigConstraintError',
      async (_l, error) => {
        const { tx, repo } = make();
        tx.shoppingConfig.update.mockRejectedValue(error);
        await expect(repo.update({ deliveryFee: 1 }, 'admin-1', () => [])).rejects.toBeInstanceOf(
          ShoppingConfigConstraintError,
        );
      },
    );

    it('maps the shape the query engine REALLY produces for a CHECK violation (unknown request error with SQLSTATE 23514)', async () => {
      const { tx, repo } = make();
      tx.shoppingConfig.update.mockRejectedValue(
        new Prisma.PrismaClientUnknownRequestError(
          'Error occurred during query execution: PostgresError { code: "23514", message: "new row for relation \\"shopping_config\\" violates check constraint \\"shopping_config_non_negative\\"" }',
          { clientVersion: 'x' },
        ),
      );
      const error = await repo
        .update({ offerWindowMinutes: 0 }, 'admin-1', () => [])
        .catch((e) => e);
      expect(error).toBeInstanceOf(ShoppingConfigConstraintError);
      expect(error.detail).toBe('shopping_config_non_negative');
    });

    it('does not mistake other unknown errors for a CHECK violation', async () => {
      const { tx, repo } = make();
      tx.shoppingConfig.update.mockRejectedValue(
        new Prisma.PrismaClientUnknownRequestError('some other failure', { clientVersion: 'x' }),
      );
      await expect(repo.update({ deliveryFee: 1 }, 'admin-1', () => [])).rejects.not.toBeInstanceOf(
        ShoppingConfigConstraintError,
      );
    });

    it('rethrows anything else', async () => {
      const { tx, repo } = make();
      tx.shoppingConfig.update.mockRejectedValue(new Error('connection lost'));
      await expect(repo.update({ deliveryFee: 1 }, 'admin-1', () => [])).rejects.toThrow(
        'connection lost',
      );
    });
  });
});
