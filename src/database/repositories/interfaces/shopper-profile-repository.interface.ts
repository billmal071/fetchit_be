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

/**
 * States in which the application cannot be (re)submitted. VERIFICATION_PENDING
 * is included so a reviewer can never approve data the shopper changed after
 * the reviewer loaded it: the shopper edits again only once it is sent back.
 */
export const APPLICATION_LOCKED_STATES: readonly ShopperAccountState[] = [
  ShopperAccountState.VERIFICATION_PENDING,
  ShopperAccountState.APPROVED,
  ShopperAccountState.SUSPENDED,
  ShopperAccountState.DEACTIVATED,
];

/** States in which a shopper cannot edit their own profile at all. */
export const PROFILE_FROZEN_STATES: readonly ShopperAccountState[] = [
  ShopperAccountState.SUSPENDED,
  ShopperAccountState.DEACTIVATED,
];

/** States in which `update` is rejected: frozen accounts, and an application under review. */
export const PROFILE_EDIT_BLOCKED_STATES: readonly ShopperAccountState[] = [
  ...PROFILE_FROZEN_STATES,
  ShopperAccountState.VERIFICATION_PENDING,
];

/** One message per rejected state, shared by the service's precheck and the repository's check. */
export const applicationLockedMessage = (state: ShopperAccountState): string =>
  state === ShopperAccountState.VERIFICATION_PENDING
    ? 'This application is already under review and can be edited again only if it is sent back for an update'
    : `This account is ${state.toLowerCase().replace(/_/g, ' ')} and can no longer submit an application`;

/**
 * Thrown by `submitApplication` when, under the row lock, the profile is in a
 * state that no longer accepts a submission (e.g. an admin approved it after
 * the caller's earlier read). Nothing was written. The service maps it to a 409.
 */
export class ApplicationLockedError extends Error {
  constructor(readonly accountState: ShopperAccountState) {
    super(applicationLockedMessage(accountState));
    this.name = 'ApplicationLockedError';
  }
}

/**
 * Thrown by `update` when, under the row lock, the profile is in
 * PROFILE_EDIT_BLOCKED_STATES. Nothing was written. The service maps it to
 * 403 (frozen) or 409 (under review).
 */
export class ProfileEditBlockedError extends Error {
  constructor(readonly accountState: ShopperAccountState) {
    super(`Profile cannot be edited while the account is ${accountState}`);
    this.name = 'ProfileEditBlockedError';
  }
}

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

  /**
   * Write profile fields and replace any relation sets given, atomically. The
   * state is re-read under the row lock; in PROFILE_EDIT_BLOCKED_STATES it
   * throws ProfileEditBlockedError and writes nothing.
   */
  update(id: string, input: IShopperProfileInput): Promise<ShopperProfileWithDetails>;

  /**
   * Submit the application: write the profile, move it to VERIFICATION_PENDING,
   * stamp `submittedAt`, clear any earlier rejection reason, and (when given)
   * save the phone number on the owning user — all in one transaction.
   *
   * The state is re-read under the row lock: if it is in
   * APPLICATION_LOCKED_STATES by then, throws ApplicationLockedError and writes
   * nothing, so a submission can never overwrite a concurrent approval.
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
   * reviewer racing the shopper's resubmission, cannot both win.
   *
   * The UPDATE is also conditional on `submittedAt` still being
   * `expectedSubmittedAt`, the submission the reviewer actually looked at. A
   * profile that was sent back, edited and resubmitted is pending again but
   * with a new `submittedAt`, so a decision on the earlier view cannot land on
   * data the reviewer never saw. Returns false when either condition no longer
   * holds (or the profile does not exist).
   */
  transitionState(
    id: string,
    from: ShopperAccountState,
    to: ShopperAccountState,
    reviewerId: string,
    rejectionReason: string | null,
    expectedSubmittedAt: Date,
  ): Promise<boolean>;
}

export const SHOPPER_PROFILE_REPOSITORY = Symbol('SHOPPER_PROFILE_REPOSITORY');
