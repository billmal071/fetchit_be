import { Prisma, ShopperAccountState, Weekday } from '@prisma/client';

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

/**
 * A profile as an admin reviews it: the same relations a shopper sees, plus the
 * account holder's contact details. Kept separate so none of this can leak
 * into the shopper-facing responses.
 */
export const shopperApplicationInclude = {
  ...shopperProfileInclude,
  user: { select: { id: true, username: true, email: true, phone: true, avatar: true } },
} satisfies Prisma.ShopperProfileInclude;

export type ShopperApplication = Prisma.ShopperProfileGetPayload<{
  include: typeof shopperApplicationInclude;
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

  /** Profiles in `state`, oldest submission first, with the total for paging. */
  findApplications(
    state: ShopperAccountState,
    skip: number,
    take: number,
  ): Promise<{ rows: ShopperApplication[]; total: number }>;

  findApplicationById(id: string): Promise<ShopperApplication | null>;

  /**
   * Move a profile from `from` to `to`, recording who reviewed it and why.
   * The state check is part of the UPDATE itself, so two reviewers, or a
   * reviewer racing the shopper's resubmission, cannot both win. Returns false
   * when the profile was no longer in `from` (or does not exist).
   */
  transitionState(
    id: string,
    from: ShopperAccountState,
    to: ShopperAccountState,
    reviewerId: string,
    rejectionReason: string | null,
  ): Promise<boolean>;
}

export const SHOPPER_PROFILE_REPOSITORY = Symbol('SHOPPER_PROFILE_REPOSITORY');
