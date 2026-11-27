import type {
  IShoppingFeeRules,
  OfferWithRequest,
  OfferWithShopper,
  ShoppingRequestWithItems,
} from '@/database/repositories';

export const RULES: IShoppingFeeRules = {
  minShopperFee: 500,
  maxShopperFee: 5000,
  deliveryFee: 1500,
  serviceChargePercent: 5,
  vatPercent: 7.5,
  priceBufferPercent: 10,
  offerWindowMinutes: 30,
};

const T0 = new Date('2026-11-24T10:00:00.000Z');

export const makeRequestRow = (
  overrides: Partial<ShoppingRequestWithItems> = {},
): ShoppingRequestWithItems => ({
  id: 'req-1',
  reference: 'SR-ABC23456',
  customerId: 'cust-1',
  status: 'OPEN',
  shoppingLocationId: 'loc-1',
  handoffArea: 'Lekki Phase 1',
  deliveryAddress: '12 Admiralty Way, Lekki',
  deliveryLatitude: 6.45,
  deliveryLongitude: 3.47,
  note: null,
  estimatedGoodsBudget: 9000,
  estimate: {
    estimatedGoodsCost: 9000,
    deliveryFee: 1500,
    platformFee: 450,
    vatOrTax: 146,
    estimatedTotal: 11096,
    priceBuffer: 900,
    shopperFeePending: true,
  },
  offerDeadline: new Date(Date.now() + 20 * 60_000),
  cancelledAt: null,
  createdAt: T0,
  updatedAt: T0,
  shoppingLocation: {
    id: 'loc-1',
    name: 'Mile 12',
    city: 'Lagos',
    state: null,
    isActive: true,
    createdAt: T0,
    updatedAt: T0,
  },
  items: [
    {
      id: 'item-1',
      requestId: 'req-1',
      position: 0,
      name: 'Milk',
      brand: 'Peak',
      size: '400g',
      quantity: 2,
      unit: 'tin',
      estimatedUnitPrice: 4500,
      notes: null,
      substitutionPreference: 'REFUND',
      maxSubstitutePrice: null,
      categoryId: 'cat-1',
      category: {
        id: 'cat-1',
        name: 'Provisions',
        slug: 'provisions',
        icon: null,
        isActive: true,
        createdAt: T0,
        updatedAt: T0,
      },
    },
  ],
  ...overrides,
});

export const BREAKDOWN = {
  estimatedGoodsCost: 9000,
  shopperFee: 1000,
  deliveryFee: 1500,
  platformFee: 450,
  vatOrTax: 221,
  customerTotal: 12171,
  priceBuffer: 900,
};

export const makeOfferRow = (overrides: Partial<OfferWithRequest> = {}): OfferWithRequest => ({
  id: 'offer-1',
  requestId: 'req-1',
  shopperProfileId: 'prof-1',
  state: 'PENDING',
  shopperFee: 1000,
  etaMinutes: 30,
  note: null,
  expiresAt: new Date(Date.now() + 20 * 60_000),
  financials: BREAKDOWN,
  createdAt: T0,
  updatedAt: T0,
  request: makeRequestRow(),
  ...overrides,
});

export const makeOfferWithShopper = (
  overrides: Partial<OfferWithShopper> = {},
): OfferWithShopper => {
  const { request: _request, ...base } = makeOfferRow();
  void _request;
  return {
    ...base,
    shopperProfile: {
      id: 'prof-1',
      displayName: 'Amaka O.',
      rating: 4.85 as never,
      completedOrders: 61,
      completionRate: 97.5 as never,
      user: { avatar: null },
    },
    ...overrides,
  };
};
