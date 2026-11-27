import { Prisma, ShoppingOffer, ShoppingOfferState } from '@prisma/client';
import { shoppingRequestInclude } from './shopping-request-repository.interface';

/** An offer with the shopper's public profile, for the customer's view. */
export const offerWithShopperInclude = {
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
} satisfies Prisma.ShoppingOfferInclude;

export type OfferWithShopper = Prisma.ShoppingOfferGetPayload<{
  include: typeof offerWithShopperInclude;
}>;

/** An offer with its request, for the shopper's view. */
export const offerWithRequestInclude = {
  request: { include: shoppingRequestInclude },
} satisfies Prisma.ShoppingOfferInclude;

export type OfferWithRequest = Prisma.ShoppingOfferGetPayload<{
  include: typeof offerWithRequestInclude;
}>;

/** Why `submit` refused to write. Nothing was written in either case. */
export class OfferRequestClosedError extends Error {
  constructor() {
    super('The request is no longer open for offers');
    this.name = 'OfferRequestClosedError';
  }
}

export class DuplicateActiveOfferError extends Error {
  constructor() {
    super('This shopper already has an active offer on the request');
    this.name = 'DuplicateActiveOfferError';
  }
}

export interface ISubmitOfferInput {
  requestId: string;
  shopperProfileId: string;
  shopperFee: number;
  etaMinutes: number;
  note?: string;
  financials: Prisma.InputJsonValue;
}

export interface IShoppingOfferRepository {
  /**
   * Create a PENDING offer. The request row is locked FOR SHARE and re-read
   * first, so a cancel or an expiry cannot slip in between the check and the
   * insert; `expiresAt` is the request's offer deadline.
   *
   * Throws OfferRequestClosedError if the request is not OPEN or its deadline
   * has passed, and DuplicateActiveOfferError (from the partial unique index
   * on PENDING offers) if the shopper already has one. Both write nothing.
   */
  submit(input: ISubmitOfferInput): Promise<OfferWithRequest>;

  /** Withdraw a PENDING offer owned by the shopper. False if it is not theirs or not PENDING. */
  withdraw(id: string, shopperProfileId: string): Promise<boolean>;

  /** Move PENDING offers past their `expiresAt` to EXPIRED, within the given scope. */
  expireDue(now: Date, scope: { requestId?: string; shopperProfileId?: string }): Promise<number>;

  findOwnedById(id: string, shopperProfileId: string): Promise<OfferWithRequest | null>;

  listForShopper(
    shopperProfileId: string,
    skip: number,
    take: number,
    state?: ShoppingOfferState,
  ): Promise<{ rows: OfferWithRequest[]; total: number }>;

  /** Offers on a request except withdrawn ones, cheapest fee first. */
  listForRequest(requestId: string): Promise<OfferWithShopper[]>;

  /** The shopper's PENDING offer on a request (at most one: the partial unique index). */
  findPendingByShopperAndRequest(
    shopperProfileId: string,
    requestId: string,
  ): Promise<ShoppingOffer | null>;

  /** Of `requestIds`, the ones the shopper has a PENDING offer on. */
  findPendingRequestIds(shopperProfileId: string, requestIds: string[]): Promise<Set<string>>;
}

export const SHOPPING_OFFER_REPOSITORY = Symbol('SHOPPING_OFFER_REPOSITORY');
