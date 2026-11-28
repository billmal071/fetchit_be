import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  IConfigViolation,
  IShoppingConfigPatch,
  IShoppingConfigRecord,
  IShoppingConfigRepository,
  IShoppingFeeRules,
  ShoppingConfigConstraintError,
  ShoppingConfigUpdateResult,
} from './interfaces';

const WITH_EDITOR = { updatedBy: { select: { id: true, username: true } } } as const;
const RULE_FIELDS: Array<keyof IShoppingFeeRules> = [
  'minShopperFee',
  'maxShopperFee',
  'deliveryFee',
  'serviceChargePercent',
  'vatPercent',
  'priceBufferPercent',
  'offerWindowMinutes',
  'shopperAcceptWindowMinutes',
  'offerAcceptanceWindowMinutes',
];

type ConfigRow = Prisma.ShoppingConfigGetPayload<object>;

const toRules = (row: ConfigRow): IShoppingFeeRules => ({
  minShopperFee: row.minShopperFee,
  maxShopperFee: row.maxShopperFee,
  deliveryFee: row.deliveryFee,
  serviceChargePercent: Number(row.serviceChargePercent),
  vatPercent: Number(row.vatPercent),
  priceBufferPercent: Number(row.priceBufferPercent),
  offerWindowMinutes: row.offerWindowMinutes,
  shopperAcceptWindowMinutes: row.shopperAcceptWindowMinutes,
  offerAcceptanceWindowMinutes: row.offerAcceptanceWindowMinutes,
});

const toRecord = (
  row: ConfigRow & { updatedBy: { id: string; username: string } | null },
): IShoppingConfigRecord => ({
  ...toRules(row),
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

/**
 * Postgres CHECK violation (SQLSTATE 23514). Prisma reports it differently depending
 * on the path: as P2004, as P2010 carrying the code, or (what the query engine does
 * for a model update, verified against a real database) as an UNKNOWN request error
 * whose message embeds the Postgres error with `code: "23514"`.
 */
const checkViolation = (error: unknown): string | null => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2004') {
      return String(error.meta?.database_error ?? error.message);
    }
    if (error.code === 'P2010' && error.meta?.code === '23514') {
      return String(error.meta?.message ?? error.message);
    }
    return null;
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /code: "23514"/.test(error.message)
  ) {
    return (
      /violates check constraint \\"([^"\\]+)\\"/.exec(error.message)?.[1] ?? 'check constraint'
    );
  }
  return null;
};

@Injectable()
export class ShoppingConfigRepository implements IShoppingConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Read from the table on every call, on purpose: there is no cache, so an admin's
  // edit is visible to the very next price, window or fee-bound calculation.
  async get(): Promise<IShoppingFeeRules | null> {
    const row = await this.prisma.shoppingConfig.findUnique({ where: { id: 1 } });
    return row ? toRules(row) : null;
  }

  async getRecord(): Promise<IShoppingConfigRecord | null> {
    const row = await this.prisma.shoppingConfig.findUnique({
      where: { id: 1 },
      include: WITH_EDITOR,
    });
    return row ? toRecord(row) : null;
  }

  async update(
    patch: IShoppingConfigPatch,
    updatedById: string,
    validate: (merged: IShoppingFeeRules) => IConfigViolation[],
  ): Promise<ShoppingConfigUpdateResult> {
    try {
      return await this.prisma.$transaction(async (tx): Promise<ShoppingConfigUpdateResult> => {
        // The lock is what makes a rule that spans fields (min <= max) safe: a second
        // edit waits here, then reads and validates against what the first one stored.
        await tx.$queryRaw`SELECT id FROM shopping_config WHERE id = 1 FOR UPDATE`;
        const row = await tx.shoppingConfig.findUnique({ where: { id: 1 }, include: WITH_EDITOR });
        if (!row) {
          return { outcome: 'missing' };
        }

        const current = toRules(row);
        const merged: IShoppingFeeRules = { ...current, ...patch };
        const errors = validate(merged);
        if (errors.length > 0) {
          return { outcome: 'invalid', errors };
        }

        const before: IShoppingConfigPatch = {};
        const after: IShoppingConfigPatch = {};
        for (const field of RULE_FIELDS) {
          if (patch[field] !== undefined && patch[field] !== current[field]) {
            before[field] = current[field];
            after[field] = patch[field];
          }
        }
        if (Object.keys(after).length === 0) {
          return { outcome: 'unchanged', record: toRecord(row) };
        }

        const updated = await tx.shoppingConfig.update({
          where: { id: 1 },
          data: { ...after, updatedById },
          include: WITH_EDITOR,
        });
        return { outcome: 'updated', before, after, record: toRecord(updated) };
      });
    } catch (error) {
      const violated = checkViolation(error);
      if (violated !== null) {
        throw new ShoppingConfigConstraintError(violated);
      }
      throw error;
    }
  }
}
