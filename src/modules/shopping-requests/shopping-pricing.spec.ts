import {
  calculateEstimate,
  calculateOfferBreakdown,
  earningsEstimate,
  goodsBudget,
  percentOf,
} from './shopping-pricing';
import { RULES } from './testing/fixtures';

describe('shopping-pricing', () => {
  it('sums quantity x unit price for the goods budget', () => {
    expect(
      goodsBudget([
        { quantity: 2, estimatedUnitPrice: 4500 },
        { quantity: 3, estimatedUnitPrice: 1200 },
      ]),
    ).toBe(12600);
  });

  it('applies percentages without floating-point drift and rounds half up', () => {
    expect(percentOf(1000, 7.5)).toBe(75);
    expect(percentOf(19, 7.5)).toBe(1); // 1.425
    expect(percentOf(20, 7.5)).toBe(2); // 1.5 rounds up
    expect(percentOf(100, 0.07)).toBe(0);
    expect(percentOf(3, 33.33)).toBe(1);
  });

  it('estimates goods + delivery + service charge + VAT, leaving the shopper fee to the bids', () => {
    expect(calculateEstimate(9000, RULES)).toEqual({
      estimatedGoodsCost: 9000,
      deliveryFee: 1500,
      platformFee: 450, // 5% of goods
      vatOrTax: 146, // 7.5% of (1500 + 450)
      estimatedTotal: 11096,
      priceBuffer: 900, // 10% of goods, kept out of the total
      shopperFeePending: true,
    });
  });

  it('adds the shopper fee and the VAT on it for an offer, and the lines sum to the total', () => {
    const b = calculateOfferBreakdown(9000, 1000, RULES);
    expect(b).toEqual({
      estimatedGoodsCost: 9000,
      shopperFee: 1000,
      deliveryFee: 1500,
      platformFee: 450,
      vatOrTax: 221, // 7.5% of (1000 + 1500 + 450)
      customerTotal: 12171,
      priceBuffer: 900,
    });
    expect(b.estimatedGoodsCost + b.shopperFee + b.deliveryFee + b.platformFee + b.vatOrTax).toBe(
      b.customerTotal,
    );
  });

  it('reads every rate from the rules it is given', () => {
    const rules = {
      ...RULES,
      deliveryFee: 0,
      serviceChargePercent: 0,
      vatPercent: 0,
      priceBufferPercent: 0,
    };
    expect(calculateOfferBreakdown(5000, 700, rules).customerTotal).toBe(5700);
    expect(calculateEstimate(5000, rules).estimatedTotal).toBe(5000);
  });

  it('gives the shopper the midpoint of the fee range as the indicative earnings', () => {
    expect(earningsEstimate(RULES)).toEqual({
      earningsEstimate: 2750,
      earningsRange: { min: 500, max: 5000 },
    });
  });
});
