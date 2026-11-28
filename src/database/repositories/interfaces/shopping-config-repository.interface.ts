import type { Prisma } from '@prisma/client';

/**
 * The admin-editable rules every shopping price is calculated from. Money is
 * whole NGN; percentages are plain percents (7.5 = 7.5%).
 */
export interface IShoppingFeeRules {
  minShopperFee: number;
  maxShopperFee: number;
  deliveryFee: number;
  serviceChargePercent: number;
  vatPercent: number;
  priceBufferPercent: number;
  offerWindowMinutes: number;
  /** Minutes a shopper has to accept an ASSIGNED order before it is cancelled. */
  shopperAcceptWindowMinutes: number;
  /** Minutes a PENDING offer stays acceptable after bidding closes (the request's offerDeadline). */
  offerAcceptanceWindowMinutes: number;
}

/** The rules plus who changed them last and when. */
export interface IShoppingConfigRecord extends IShoppingFeeRules {
  updatedAt: Date;
  /** Null for the seeded values, or after the admin who set them was deleted. */
  updatedBy: { id: string; username: string } | null;
}

/** A partial edit: only the fields present are changed. */
export type IShoppingConfigPatch = Partial<IShoppingFeeRules>;

export interface IConfigViolation {
  field: string;
  message: string;
}

export type ShoppingConfigUpdateResult =
  | {
      outcome: 'updated';
      /** Only the fields that actually changed, as stored before and as stored now. */
      before: IShoppingConfigPatch;
      after: IShoppingConfigPatch;
      record: IShoppingConfigRecord;
    }
  // Every field sent already had that value: nothing was written.
  | { outcome: 'unchanged'; record: IShoppingConfigRecord }
  // The merged result broke a rule; nothing was written.
  | { outcome: 'invalid'; errors: IConfigViolation[] }
  | { outcome: 'missing' };

/** A database CHECK refused the write (a rule `validate` should have caught first). */
export class ShoppingConfigConstraintError extends Error {
  constructor(readonly detail: string) {
    super(`A configuration constraint refused the update: ${detail}`);
    this.name = 'ShoppingConfigConstraintError';
  }
}

/** Runs in the update's own transaction; see IShoppingConfigRepository.update. */
export type ShoppingConfigUpdatedHook = (
  tx: Prisma.TransactionClient,
  change: { before: IShoppingConfigPatch; after: IShoppingConfigPatch },
) => Promise<void>;

export interface IShoppingConfigRepository {
  /** The current rules, or null if the config row has not been created. */
  get(): Promise<IShoppingFeeRules | null>;

  /** The current rules with who last changed them and when. */
  getRecord(): Promise<IShoppingConfigRecord | null>;

  /**
   * Apply a partial edit to the singleton row, atomically. The row is locked
   * (SELECT ... FOR UPDATE) for the whole transaction, `validate` is run on the
   * MERGED result (stored values overlaid with the patch) under that lock, and
   * a single UPDATE follows: two concurrent edits therefore cannot together
   * break a rule that spans fields (min <= max), because the second one is
   * validated against what the first one stored.
   *
   * `onUpdated`, when given, runs INSIDE the same transaction right after an
   * effective write (never for a no-op or an invalid edit) with the transaction
   * client: whatever it writes (the audit row) commits with the change, and if it
   * throws, the change is rolled back and the error propagates.
   *
   * Throws ShoppingConfigConstraintError if a database CHECK refuses the write.
   */
  update(
    patch: IShoppingConfigPatch,
    updatedById: string,
    validate: (merged: IShoppingFeeRules) => IConfigViolation[],
    onUpdated?: ShoppingConfigUpdatedHook,
  ): Promise<ShoppingConfigUpdateResult>;
}

export const SHOPPING_CONFIG_REPOSITORY = Symbol('SHOPPING_CONFIG_REPOSITORY');
