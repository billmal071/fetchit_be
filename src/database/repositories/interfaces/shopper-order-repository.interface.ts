import {
  OrderEvent,
  OrderState,
  Prisma,
  ShoppingOfferState,
  ShoppingRequestStatus,
} from '@prisma/client';

/** Event types written to order_events. Strings, so later slices add types without a migration. */
export const ORDER_EVENT_TYPES = {
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  SHOPPER_ACCEPTED: 'SHOPPER_ACCEPTED',
  SHOPPING_STARTED: 'SHOPPING_STARTED',
} as const;

const orderItemsInclude = { orderBy: { position: 'asc' } } as const;

/**
 * What the CUSTOMER sees of an order: their own request's address and note,
 * and the shopper's public profile only (never email, phone or user id).
 */
export const customerOrderInclude = {
  items: orderItemsInclude,
  shoppingLocation: true,
  request: {
    select: {
      reference: true,
      deliveryAddress: true,
      deliveryLatitude: true,
      deliveryLongitude: true,
      note: true,
    },
  },
  shopperProfile: {
    select: {
      id: true,
      displayName: true,
      rating: true,
      completedOrders: true,
      completionRate: true,
      user: { select: { avatar: true } },
    },
  },
} satisfies Prisma.ShopperOrderInclude;

export type CustomerOrder = Prisma.ShopperOrderGetPayload<{
  include: typeof customerOrderInclude;
}>;

/**
 * What the SHOPPER sees: no address, coordinates or note (they are revealed
 * only after payment, a later slice) and no customer identity. The request
 * contributes its reference and nothing else.
 */
export const shopperOrderInclude = {
  items: orderItemsInclude,
  shoppingLocation: true,
  request: { select: { reference: true } },
} satisfies Prisma.ShopperOrderInclude;

export type ShopperOrderForShopper = Prisma.ShopperOrderGetPayload<{
  include: typeof shopperOrderInclude;
}>;

export type OrderListFilter = 'active' | 'completed' | 'cancelled';

/** Terminal states: everything else is "active". */
export const orderStatesFor = (
  filter: OrderListFilter,
): Prisma.EnumOrderStateFilter | OrderState => {
  switch (filter) {
    case 'completed':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return { notIn: ['COMPLETED', 'CANCELLED'] };
  }
};

export interface IAcceptOfferInput {
  requestId: string;
  offerId: string;
  customerId: string;
}

/** A shopper whose offer lost, so they can be told. */
export interface IRejectedOfferShopper {
  offerId: string;
  userId: string;
}

export type AcceptOfferResult =
  | {
      outcome: 'accepted';
      order: CustomerOrder;
      winnerUserId: string;
      requestReference: string;
      rejected: IRejectedOfferShopper[];
    }
  | {
      // The same offer was already accepted by this customer: a retry, not a new order.
      outcome: 'already_accepted';
      order: CustomerOrder;
    }
  | { outcome: 'shopper_unavailable' }
  | { outcome: 'not_found' }
  | { outcome: 'request_not_open'; status: ShoppingRequestStatus }
  | { outcome: 'offer_not_pending'; state: ShoppingOfferState }
  | { outcome: 'offer_expired' };

export type OrderTransitionResult =
  | { outcome: 'transitioned'; order: ShopperOrderForShopper }
  | { outcome: 'not_found' }
  | { outcome: 'conflict'; state: OrderState };

export interface IShopperOrderRepository {
  /**
   * Accept an offer, atomically: lock the request row, require it OPEN, the
   * offer PENDING and inside its deadline (clock read after the lock), then
   * mark the offer ACCEPTED, every other PENDING offer REJECTED, the request
   * ASSIGNED, and create the order, its items and the OFFER_ACCEPTED event.
   * The order is created UNPAID: no payment exists yet (Part C). The offer's
   * stored breakdown is copied, never recomputed.
   *
   * Concurrent accepts and cancels serialise on the row lock; exactly one wins.
   * The lock query filters on the owner, so a non-owner locks nothing and reads
   * not_found. The bidding shopper must still be APPROVED (their profile row is
   * locked FOR SHARE, so a suspension cannot slip in before commit), else
   * shopper_unavailable and nothing changes. Accepting the already-accepted
   * offer again returns already_accepted with the existing order.
   */
  acceptOffer(input: IAcceptOfferInput): Promise<AcceptOfferResult>;

  listForCustomer(
    customerId: string,
    skip: number,
    take: number,
    filter?: OrderListFilter,
  ): Promise<{ rows: CustomerOrder[]; total: number }>;

  findOwnedByCustomer(id: string, customerId: string): Promise<CustomerOrder | null>;

  listForShopper(
    shopperProfileId: string,
    skip: number,
    take: number,
    filter?: OrderListFilter,
  ): Promise<{ rows: ShopperOrderForShopper[]; total: number }>;

  findOwnedByShopper(id: string, shopperProfileId: string): Promise<ShopperOrderForShopper | null>;

  /** Events of an order the caller already proved they may read. */
  listEvents(orderId: string, order: 'asc' | 'desc'): Promise<OrderEvent[]>;

  /**
   * Move an order the shopper is assigned to from `from` to `to` and record the
   * event, in one transaction. The `from` check is part of the UPDATE, so of
   * two concurrent calls exactly one transitions; the other gets `conflict`.
   */
  transition(input: {
    id: string;
    shopperProfileId: string;
    actorId: string;
    from: OrderState;
    to: OrderState;
    eventType: string;
    stamp: 'shopperAcceptedAt' | 'shoppingStartedAt';
  }): Promise<OrderTransitionResult>;
}

export const SHOPPER_ORDER_REPOSITORY = Symbol('SHOPPER_ORDER_REPOSITORY');
