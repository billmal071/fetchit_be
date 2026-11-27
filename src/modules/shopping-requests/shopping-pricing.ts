import type { IShoppingFeeRules } from '@/database/repositories';

/**
 * Pure fee calculations. Every rate comes from the admin-editable
 * shopping_config row (IShoppingFeeRules); nothing here is a constant. Money is
 * whole NGN and every line is rounded (half up) to a whole naira on its own, so
 * the lines always add up to the total exactly.
 */

/** A percentage applied to whole NGN without floating-point drift (7.5% = 750 basis points). */
export const percentOf = (amount: number, percent: number): number =>
  Math.round((amount * Math.round(percent * 100)) / 10_000);

/**
 * Ceiling for any stored or quoted amount, well under int4 (2,147,483,647) so
 * the database columns can never overflow. Applies to each line, the goods
 * budget and the estimated total.
 */
export const MAX_AMOUNT = 1_000_000_000;

export interface IRequestEstimate {
  estimatedGoodsCost: number;
  deliveryFee: number;
  /** Fetchit's service charge (serviceChargePercent of the goods estimate). */
  platformFee: number;
  vatOrTax: number;
  /** Everything except the shopper fee, which is set by the bids. */
  estimatedTotal: number;
  /** Refundable cushion held against price increases; NOT part of estimatedTotal. */
  priceBuffer: number;
  shopperFeePending: true;
}

export interface IOfferBreakdown {
  estimatedGoodsCost: number;
  shopperFee: number;
  deliveryFee: number;
  platformFee: number;
  vatOrTax: number;
  customerTotal: number;
  /** Refundable cushion held against price increases; NOT part of customerTotal. */
  priceBuffer: number;
}

/** VAT is charged on the service lines (shopper fee, delivery, service charge), not on the goods. */
const vatOn = (rules: IShoppingFeeRules, serviceLines: number): number =>
  percentOf(serviceLines, rules.vatPercent);

export function goodsBudget(
  items: Array<{ quantity: number; estimatedUnitPrice: number }>,
): number {
  return items.reduce((sum, item) => sum + item.quantity * item.estimatedUnitPrice, 0);
}

export function calculateEstimate(goods: number, rules: IShoppingFeeRules): IRequestEstimate {
  const platformFee = percentOf(goods, rules.serviceChargePercent);
  const vatOrTax = vatOn(rules, rules.deliveryFee + platformFee);
  return {
    estimatedGoodsCost: goods,
    deliveryFee: rules.deliveryFee,
    platformFee,
    vatOrTax,
    estimatedTotal: goods + rules.deliveryFee + platformFee + vatOrTax,
    priceBuffer: percentOf(goods, rules.priceBufferPercent),
    shopperFeePending: true,
  };
}

export function calculateOfferBreakdown(
  goods: number,
  shopperFee: number,
  rules: IShoppingFeeRules,
): IOfferBreakdown {
  const platformFee = percentOf(goods, rules.serviceChargePercent);
  const vatOrTax = vatOn(rules, shopperFee + rules.deliveryFee + platformFee);
  return {
    estimatedGoodsCost: goods,
    shopperFee,
    deliveryFee: rules.deliveryFee,
    platformFee,
    vatOrTax,
    customerTotal: goods + shopperFee + rules.deliveryFee + platformFee + vatOrTax,
    priceBuffer: percentOf(goods, rules.priceBufferPercent),
  };
}

/**
 * What a shopper can expect to earn before bidding. The fee is whatever they
 * bid inside [min, max], so the indicative figure is the midpoint of that
 * range, and the range itself is returned alongside it.
 */
export function earningsEstimate(rules: IShoppingFeeRules): {
  earningsEstimate: number;
  earningsRange: { min: number; max: number };
} {
  return {
    earningsEstimate: Math.round((rules.minShopperFee + rules.maxShopperFee) / 2),
    earningsRange: { min: rules.minShopperFee, max: rules.maxShopperFee },
  };
}
