import { Prisma, ShoppingRequestStatus, SubstitutionPreference } from '@prisma/client';

/** Relations every shopping-request read returns, so all callers see the same shape. */
export const shoppingRequestInclude = {
  items: { orderBy: { position: 'asc' }, include: { category: true } },
  shoppingLocation: true,
} satisfies Prisma.ShoppingRequestInclude;

export type ShoppingRequestWithItems = Prisma.ShoppingRequestGetPayload<{
  include: typeof shoppingRequestInclude;
}>;

/** The offer count is of PENDING offers still inside their window at `now`, so it never lags the deadline. */
export const shoppingRequestListInclude = (now: Date) =>
  ({
    ...shoppingRequestInclude,
    _count: {
      select: {
        offers: {
          where: {
            state: 'PENDING',
            expiresAt: { gt: now },
            shopperProfile: { accountState: 'APPROVED' },
          },
        },
      },
    },
  }) satisfies Prisma.ShoppingRequestInclude;

export type ShoppingRequestListRow = Prisma.ShoppingRequestGetPayload<{
  include: ReturnType<typeof shoppingRequestListInclude>;
}>;

export interface IShoppingRequestItemInput {
  name: string;
  brand: string;
  size: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: number;
  notes?: string;
  substitutionPreference: SubstitutionPreference;
  maxSubstitutePrice?: number;
  categoryId?: string;
}

export interface ICreateShoppingRequestInput {
  customerId: string;
  shoppingLocationId: string;
  handoffArea?: string;
  deliveryAddress: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  note?: string;
  estimatedGoodsBudget: number;
  estimate: Prisma.InputJsonValue;
  offerDeadline: Date;
  items: IShoppingRequestItemInput[];
}

export type CancelShoppingRequestResult =
  | { outcome: 'cancelled'; request: ShoppingRequestWithItems }
  | { outcome: 'not_found' }
  | { outcome: 'not_open'; status: ShoppingRequestStatus };

export interface IShopperFeedQuery {
  shopperProfileId: string;
  now: Date;
  locationId?: string;
  categoryId?: string;
  sortBy: 'createdAt' | 'offerDeadline';
  sortOrder: 'asc' | 'desc';
  skip: number;
  take: number;
}

/**
 * The rule that decides which requests a shopper is shown. A request matches
 * when it is OPEN, its offer window is still running, its market is one the
 * shopper covers, and at least one item is in a category the shopper covers.
 * Items with no category cannot be matched on category; a request whose items
 * have NO category at all is therefore shown to every shopper at that market
 * (otherwise it would be invisible to everyone).
 *
 * "Online" and "approved" are properties of the shopper, not of the request,
 * and are checked by the service before this query runs.
 */
export const shopperMatchWhere = (
  shopperProfileId: string,
  now: Date,
): Prisma.ShoppingRequestWhereInput => ({
  status: 'OPEN',
  offerDeadline: { gt: now },
  ...shopperCoverageWhere(shopperProfileId),
});

/** Market and category coverage alone: the part of matching that ignores whether the request is still open. */
export const shopperCoverageWhere = (
  shopperProfileId: string,
): Prisma.ShoppingRequestWhereInput => ({
  shoppingLocation: { shopperProfiles: { some: { shopperProfileId } } },
  OR: [
    {
      items: {
        some: { category: { shopperProfiles: { some: { shopperProfileId } } } },
      },
    },
    { items: { none: { categoryId: { not: null } } } },
  ],
});

export interface IShoppingRequestRepository {
  /** Insert the request and its items atomically; generates a unique reference. */
  create(input: ICreateShoppingRequestInput): Promise<ShoppingRequestWithItems>;

  findOwnedById(id: string, customerId: string): Promise<ShoppingRequestWithItems | null>;

  listForCustomer(
    customerId: string,
    skip: number,
    take: number,
    status?: ShoppingRequestStatus,
    now?: Date,
  ): Promise<{ rows: ShoppingRequestListRow[]; total: number }>;

  /**
   * Cancel an OPEN request owned by `customerId` and expire its PENDING offers,
   * in one transaction. The OPEN check is part of the UPDATE, so two cancels,
   * or a cancel racing an offer submit, cannot both win.
   */
  cancel(id: string, customerId: string, now: Date): Promise<CancelShoppingRequestResult>;

  /** Requests matching the shopper (see shopperMatchWhere), with the total for paging. */
  findMatchingForShopper(
    query: IShopperFeedQuery,
  ): Promise<{ rows: ShoppingRequestWithItems[]; total: number }>;

  /**
   * One request in a market and category the shopper covers, whatever its
   * status: lets the service tell "not for you" (404) from "closed" (409).
   */
  findCoveredByShopper(
    id: string,
    shopperProfileId: string,
  ): Promise<ShoppingRequestWithItems | null>;

  /**
   * One request the shopper may read: one that currently matches them, or any
   * request they have ever placed an offer on (so a closed request stays
   * readable from their offer).
   */
  findReadableByShopper(
    id: string,
    shopperProfileId: string,
    now: Date,
  ): Promise<ShoppingRequestWithItems | null>;
}

export const SHOPPING_REQUEST_REPOSITORY = Symbol('SHOPPING_REQUEST_REPOSITORY');
