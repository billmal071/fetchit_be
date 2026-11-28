import type { OrderEvent } from '@prisma/client';
import type { CustomerOrder, ShopperOrderForShopper } from '@/database/repositories';
import { IOfferBreakdown } from './shopping-pricing';
import {
  CustomerOrderDetailResponseDto,
  CustomerOrderResponseDto,
  LocationSummaryDto,
  OrderEventResponseDto,
  OrderItemResponseDto,
  ShopperOrderResponseDto,
} from './dto';

const orUndefined = <T>(value: T | null | undefined): T | undefined =>
  value === null ? undefined : value;
const iso = (date: Date): string => date.toISOString();

const toLocation = (row: CustomerOrder['shoppingLocation']): LocationSummaryDto => ({
  id: row.id,
  name: row.name,
  city: orUndefined(row.city),
  state: orUndefined(row.state),
});

const toItem = (row: CustomerOrder['items'][number]): OrderItemResponseDto => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  size: row.size,
  quantity: row.quantity,
  unit: row.unit,
  notes: orUndefined(row.notes),
  state: row.state,
  substitutionPreference: row.substitutionPreference,
  maxSubstitutePrice: orUndefined(row.maxSubstitutePrice),
  customerEstimatedPrice: row.customerEstimatedPrice,
  shopperEstimatedPrice: orUndefined(row.shopperEstimatedPrice),
  actualPurchasePrice: orUndefined(row.actualPurchasePrice),
  approvedPrice: orUndefined(row.approvedPrice),
  finalPurchasePrice: orUndefined(row.finalPurchasePrice),
});

/** actorId is deliberately not exposed: it would hand one party the other's user id. */
export const toOrderEvent = (row: OrderEvent): OrderEventResponseDto => ({
  id: row.id,
  type: row.type,
  actorRole: orUndefined(row.actorRole),
  metadata: (orUndefined(row.metadata) as Record<string, unknown> | undefined) ?? undefined,
  createdAt: iso(row.createdAt),
});

/**
 * The shopper's feed: the customer's cancel reason is free text and can carry a
 * phone number or an address, so it is dropped from the event metadata.
 */
export const toShopperOrderEvent = (row: OrderEvent): OrderEventResponseDto => {
  const event = toOrderEvent(row);
  if (event.metadata && 'reason' in event.metadata) {
    const { reason: _reason, ...rest } = event.metadata;
    void _reason;
    return { ...event, metadata: rest };
  }
  return event;
};

const breakdownOf = (order: { financials: unknown }): IOfferBreakdown =>
  order.financials as IOfferBreakdown;

export function toCustomerOrder(order: CustomerOrder): CustomerOrderResponseDto {
  const { shopperProfile: shopper, request } = order;
  return {
    id: order.id,
    reference: order.reference,
    requestId: order.requestId,
    requestReference: request.reference,
    state: order.state,
    shoppingLocation: toLocation(order.shoppingLocation),
    handoffArea: orUndefined(order.handoffArea),
    handoffAt: order.handoffAt ? iso(order.handoffAt) : undefined,
    deliveryAddress: {
      text: request.deliveryAddress,
      latitude: orUndefined(request.deliveryLatitude),
      longitude: orUndefined(request.deliveryLongitude),
    },
    note: orUndefined(request.note),
    items: order.items.map(toItem),
    itemCount: order.items.length,
    // The shopper's earnings are not the customer's business.
    financials: breakdownOf(order),
    shopper: {
      id: shopper.id,
      displayName: orUndefined(shopper.displayName),
      avatarUrl: orUndefined(shopper.user.avatar),
      rating: shopper.rating === null ? undefined : Number(shopper.rating),
      completedOrders: shopper.completedOrders,
      completionRate: shopper.completionRate === null ? undefined : Number(shopper.completionRate),
    },
    cancelledAt: order.cancelledAt ? iso(order.cancelledAt) : undefined,
    cancelledBy: orUndefined(order.cancelledBy),
    cancelReason: orUndefined(order.cancelReason),
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

export function toCustomerOrderDetail(
  order: CustomerOrder,
  events: OrderEvent[],
): CustomerOrderDetailResponseDto {
  return { ...toCustomerOrder(order), events: events.map(toOrderEvent) };
}

/**
 * No address, coordinates, note or customer identity: those are revealed to the
 * shopper only after payment (a later slice).
 */
export function toShopperOrder(order: ShopperOrderForShopper): ShopperOrderResponseDto {
  const financials = breakdownOf(order);
  return {
    id: order.id,
    reference: order.reference,
    state: order.state,
    shoppingLocation: toLocation(order.shoppingLocation),
    handoffArea: orUndefined(order.handoffArea),
    handoffAt: order.handoffAt ? iso(order.handoffAt) : undefined,
    items: order.items.map(toItem),
    itemCount: order.items.length,
    extraServices: [],
    receipts: [],
    financials: { ...financials, shopperGrossEarnings: financials.shopperFee },
    pendingApprovals: 0,
    acceptedAt: order.shopperAcceptedAt ? iso(order.shopperAcceptedAt) : undefined,
    startedAt: order.shoppingStartedAt ? iso(order.shoppingStartedAt) : undefined,
    cancelledAt: order.cancelledAt ? iso(order.cancelledAt) : undefined,
    cancelledBy: orUndefined(order.cancelledBy),
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}
