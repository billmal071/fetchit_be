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
}

export interface IShoppingConfigRepository {
  /** The current rules, or null if the config row has not been created. */
  get(): Promise<IShoppingFeeRules | null>;
}

export const SHOPPING_CONFIG_REPOSITORY = Symbol('SHOPPING_CONFIG_REPOSITORY');
