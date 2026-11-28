import type { IConfigViolation, IShoppingFeeRules } from '@/database/repositories';

/** Same ceiling as every other stored or quoted amount (well under int4). */
export const MAX_FEE = 1_000_000_000;
export const MAX_PERCENT = 100;
/** 30 days, in minutes. */
export const MAX_WINDOW_MINUTES = 60 * 24 * 30;

/**
 * At most two decimal places, judged on the number's shortest decimal string rather than
 * by float arithmetic (7.501 * 100 is not exactly 750.1, 2.675 * 100 is not 267.5): the
 * column is Decimal(5,2), which would silently round anything finer and break the
 * repository's diff and no-op contracts. Exponent forms (1e-7) never match.
 */
const hasAtMostTwoDecimals = (value: number): boolean => /^\d+(\.\d{1,2})?$/.test(String(value));

const FEE_FIELDS = ['minShopperFee', 'maxShopperFee', 'deliveryFee'] as const;
const PERCENT_FIELDS = ['serviceChargePercent', 'vatPercent', 'priceBufferPercent'] as const;
const WINDOW_FIELDS = [
  'offerWindowMinutes',
  'shopperAcceptWindowMinutes',
  'offerAcceptanceWindowMinutes',
] as const;

/**
 * Every rule, judged on the MERGED configuration (stored values overlaid with
 * the edit), so an edit of only one side of a cross-field rule is still checked
 * against the stored other side. Returned as violations (the 422 body), never
 * thrown: the database CHECKs are the last line of defence, not the first.
 */
export function validateShoppingConfig(merged: IShoppingFeeRules): IConfigViolation[] {
  const errors: IConfigViolation[] = [];

  for (const field of FEE_FIELDS) {
    const value = merged[field];
    if (!Number.isInteger(value) || value < 0 || value > MAX_FEE) {
      errors.push({ field, message: `${field} must be a whole number between 0 and ${MAX_FEE}` });
    }
  }
  if (merged.minShopperFee > merged.maxShopperFee) {
    errors.push({
      field: 'minShopperFee',
      message: `minShopperFee (${merged.minShopperFee}) must not be more than maxShopperFee (${merged.maxShopperFee})`,
    });
  }
  for (const field of PERCENT_FIELDS) {
    const value = merged[field];
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_PERCENT ||
      !hasAtMostTwoDecimals(value)
    ) {
      errors.push({
        field,
        message: `${field} must be between 0 and ${MAX_PERCENT}, with at most two decimal places`,
      });
    }
  }
  for (const field of WINDOW_FIELDS) {
    const value = merged[field];
    if (!Number.isInteger(value) || value < 1 || value > MAX_WINDOW_MINUTES) {
      errors.push({
        field,
        message: `${field} must be a whole number of minutes between 1 and ${MAX_WINDOW_MINUTES}`,
      });
    }
  }
  return errors;
}
