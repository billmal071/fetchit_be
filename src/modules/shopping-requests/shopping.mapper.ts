import type { ShoppingOffer } from '@prisma/client';
import type {
  IShoppingFeeRules,
  OfferWithRequest,
  OfferWithShopper,
  ShoppingRequestListRow,
  ShoppingRequestWithItems,
} from '@/database/repositories';
import { IOfferBreakdown, IRequestEstimate, earningsEstimate } from './shopping-pricing';
import {
  CustomerOfferResponseDto,
  LocationSummaryDto,
  OfferBreakdownResponseDto,
  RequestItemResponseDto,
  ShopperOfferResponseDto,
  ShopperOfferWithRequestResponseDto,
  ShopperRequestDetailResponseDto,
  ShopperRequestSummaryResponseDto,
  ShoppingRequestDetailResponseDto,
  ShoppingRequestResponseDto,
} from './dto';

/** A missing field means "not applicable"; nulls are dropped rather than sent. */
const orUndefined = <T>(value: T | null | undefined): T | undefined =>
  value === null ? undefined : value;

const iso = (date: Date): string => date.toISOString();

function toItem(row: ShoppingRequestWithItems['items'][number]): RequestItemResponseDto {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    size: row.size,
    quantity: row.quantity,
    unit: row.unit,
    estimatedUnitPrice: row.estimatedUnitPrice,
    notes: orUndefined(row.notes),
    substitutionPreference: row.substitutionPreference,
    maxSubstitutePrice: orUndefined(row.maxSubstitutePrice),
    category: row.category ? { id: row.category.id, name: row.category.name } : undefined,
  };
}

const toLocation = (row: ShoppingRequestWithItems['shoppingLocation']): LocationSummaryDto => ({
  id: row.id,
  name: row.name,
  city: orUndefined(row.city),
  state: orUndefined(row.state),
});

/** The distinct categories across a request's items. */
const categoriesOf = (row: ShoppingRequestWithItems): Array<{ id: string; name: string }> => {
  const seen = new Map<string, { id: string; name: string }>();
  for (const item of row.items) {
    if (item.category && !seen.has(item.category.id)) {
      seen.set(item.category.id, { id: item.category.id, name: item.category.name });
    }
  }
  return [...seen.values()];
};

const breakdownOf = (offer: Pick<ShoppingOffer, 'financials'>): IOfferBreakdown =>
  offer.financials as unknown as IOfferBreakdown;

// ------------------------------------------------------------------ customer

export function toRequestResponse(
  row: ShoppingRequestWithItems | ShoppingRequestListRow,
): ShoppingRequestResponseDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    shoppingLocation: toLocation(row.shoppingLocation),
    deliveryAddress: {
      text: row.deliveryAddress,
      latitude: orUndefined(row.deliveryLatitude),
      longitude: orUndefined(row.deliveryLongitude),
    },
    handoffArea: orUndefined(row.handoffArea),
    note: orUndefined(row.note),
    items: row.items.map(toItem),
    itemCount: row.items.length,
    estimatedGoodsBudget: row.estimatedGoodsBudget,
    estimate: row.estimate as unknown as IRequestEstimate,
    offerDeadline: iso(row.offerDeadline),
    offerCount: '_count' in row ? row._count.offers : undefined,
    cancelledAt: row.cancelledAt ? iso(row.cancelledAt) : undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toCustomerOffer(offer: OfferWithShopper): CustomerOfferResponseDto {
  const { shopperProfile: shopper } = offer;
  return {
    id: offer.id,
    state: offer.state,
    shopperFee: offer.shopperFee,
    etaMinutes: offer.etaMinutes,
    note: orUndefined(offer.note),
    expiresAt: iso(offer.expiresAt),
    createdAt: iso(offer.createdAt),
    financials: breakdownOf(offer),
    shopper: {
      id: shopper.id,
      displayName: orUndefined(shopper.displayName),
      avatarUrl: orUndefined(shopper.user.avatar),
      rating: shopper.rating === null ? undefined : Number(shopper.rating),
      completedOrders: shopper.completedOrders,
      completionRate: shopper.completionRate === null ? undefined : Number(shopper.completionRate),
    },
  };
}

export function toRequestDetail(
  row: ShoppingRequestWithItems,
  offers: OfferWithShopper[],
): ShoppingRequestDetailResponseDto {
  return {
    ...toRequestResponse(row),
    offerCount: offers.filter((offer) => offer.state === 'PENDING').length,
    offers: offers.map(toCustomerOffer),
  };
}

// ------------------------------------------------------------------- shopper

/**
 * The shopper never sees the exact delivery address, the customer's identity or
 * the customer's free-text note (it can carry phone numbers or addresses):
 * only the market and the coarse `handoffArea`.
 */
export function toShopperSummary(
  row: ShoppingRequestWithItems,
  rules: IShoppingFeeRules,
  hasSubmittedOffer: boolean,
): ShopperRequestSummaryResponseDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    offerDeadline: iso(row.offerDeadline),
    itemCount: row.items.length,
    estimatedGoodsBudget: row.estimatedGoodsBudget,
    shoppingLocation: toLocation(row.shoppingLocation),
    handoffArea: orUndefined(row.handoffArea),
    categories: categoriesOf(row),
    ...earningsEstimate(rules),
    hasSubmittedOffer,
    createdAt: iso(row.createdAt),
  };
}

export function toShopperOffer(
  offer: Pick<
    ShoppingOffer,
    'requestId' | 'shopperProfileId' | 'state' | 'shopperFee' | 'etaMinutes' | 'note' | 'expiresAt'
  > &
    Partial<Pick<ShoppingOffer, 'id' | 'createdAt'>>,
  financials: IOfferBreakdown,
): ShopperOfferResponseDto {
  const breakdown: OfferBreakdownResponseDto = {
    ...financials,
    shopperGrossEarnings: financials.shopperFee,
  };
  return {
    id: offer.id,
    requestId: offer.requestId,
    shopperId: offer.shopperProfileId,
    state: offer.state,
    shopperFee: offer.shopperFee,
    etaMinutes: offer.etaMinutes,
    note: orUndefined(offer.note),
    expiresAt: iso(offer.expiresAt),
    createdAt: offer.createdAt ? iso(offer.createdAt) : undefined,
    financials: breakdown,
  };
}

export function toShopperOfferWithRequest(
  offer: OfferWithRequest,
  rules: IShoppingFeeRules,
): ShopperOfferWithRequestResponseDto {
  return {
    ...toShopperOffer(offer, breakdownOf(offer)),
    request: toShopperSummary(offer.request, rules, offer.state === 'PENDING'),
  };
}

export function toShopperDetail(
  row: ShoppingRequestWithItems,
  rules: IShoppingFeeRules,
  myOffer: ShoppingOffer | undefined,
): ShopperRequestDetailResponseDto {
  return {
    ...toShopperSummary(row, rules, myOffer !== undefined),
    items: row.items.map(toItem),
    myOffer: myOffer ? toShopperOffer(myOffer, breakdownOf(myOffer)) : undefined,
  };
}
