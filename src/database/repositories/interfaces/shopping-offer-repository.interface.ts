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

/**
 * The shopper's earlier order on this request was cancelled (by the customer, by
 * the accept timeout, or by them): they may not bid on it again.
 */
export class ShopperBarredFromRequestError extends Error {
  constructor() {
    super('The shopper may no longer bid on this request: their earlier order on it was cancelled');
    this.name = 'ShopperBarredFromRequestError';
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
  /**
   * The offer stays acceptable this many minutes after BIDDING closes:
   * expiresAt = the request's offerDeadline + this, worked out inside the
   * submit transaction. (The deadline itself only closes bidding.)
   */
  acceptanceWindowMinutes: number;
}

export interface IShoppingOfferRepository {
  /**
   * Create a PENDING offer. The request row is locked FOR SHARE and re-read
   * first, so a cancel or an expiry cannot slip in between the check and the
   * insert. Bidding must still be open (status OPEN and the request's offerDeadline
   * ahead); `expiresAt` is that deadline plus `acceptanceWindowMinutes`, so the
   * offer outlives the bidding window.
   *
   * Throws OfferRequestClosedError if the request is not OPEN or its bidding
   * deadline has passed, ShopperBarredFromRequestError if the shopper has a
   * CANCELLED order on this request (checked under the same lock, so a cancel
   * that commits first bars the bid, and a bid that wins the lock first stands),
   * and DuplicateActiveOfferError (from the partial unique index
   * on PENDING offers) if the shopper already has one. Both write nothing.
   */
  submit(input: ISubmitOfferInput): Promise<OfferWithRequest>;

  /** Withdraw a PENDING offer owned by the shopper. False if it is not theirs or not PENDING. */
  withdraw(id: string, shopperProfileId: string): Promise<boolean>;

  /**
   * Move PENDING offers past their `expiresAt` to EXPIRED, within the given scope.
   * `expiresAt` is the end of the ACCEPTANCE window, not the bidding deadline: an
   * offer is not expired merely because bidding has closed.
   */
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
