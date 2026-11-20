import { Prisma, Weekday } from '@prisma/client';

/** Relations every shopper-profile read returns, so all callers see the same shape. */
export const shopperProfileInclude = {
  categories: { include: { category: true } },
  locations: { include: { location: true } },
  services: { include: { service: true } },
  availability: true,
  user: { select: { avatar: true } },
} satisfies Prisma.ShopperProfileInclude;

export type ShopperProfileWithDetails = Prisma.ShopperProfileGetPayload<{
  include: typeof shopperProfileInclude;
}>;

export interface IAvailabilityInput {
  weekday: Weekday;
  startTime?: string;
  endTime?: string;
}

/**
 * Fields a shopper can change. A relation set that is present REPLACES the
 * stored one; a missing one is left alone.
 */
export interface IShopperProfileInput {
  displayName?: string;
  bio?: string;
  yearsOfExperience?: number;
  categoryIds?: string[];
  locationIds?: string[];
  serviceIds?: string[];
  availability?: IAvailabilityInput[];
}

/**
 * Shopper Profile Repository Interface
 *
 * Does not extend IBaseRepository: a shopper profile is only ever reached
 * through its owning user, and its relation sets are always written together
 * with the profile row.
 */
export interface IShopperProfileRepository {
  /**
   * Return the profile for a user, creating a default REGISTERED one if none
   * exists yet. Idempotent and safe under concurrent first-time reads.
   */
  ensureByUserId(userId: string): Promise<ShopperProfileWithDetails>;

  /** Write profile fields and replace any relation sets given, atomically. */
  update(id: string, input: IShopperProfileInput): Promise<ShopperProfileWithDetails>;

  /**
   * Submit the application: write the profile, move it to VERIFICATION_PENDING,
   * stamp `submittedAt`, clear any earlier rejection reason, and (when given)
   * save the phone number on the owning user — all in one transaction.
   */
  submitApplication(
    id: string,
    userId: string,
    input: IShopperProfileInput,
    phone?: string,
  ): Promise<ShopperProfileWithDetails>;

  setOnline(id: string, isOnline: boolean): Promise<ShopperProfileWithDetails>;
}

export const SHOPPER_PROFILE_REPOSITORY = Symbol('SHOPPER_PROFILE_REPOSITORY');
