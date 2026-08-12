import { HandymanProfile, Prisma, VerificationStatus } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Handyman Profile Repository Interface
 *
 * Defines all data access operations for HandymanProfile entity.
 * Does not extend ISoftDeleteRepository as HandymanProfile has no deletedAt field.
 */
export interface IHandymanProfileRepository extends IBaseRepository<
  HandymanProfile,
  Prisma.HandymanProfileCreateInput,
  Prisma.HandymanProfileUpdateInput
> {
  /**
   * Find handyman profile by user ID
   */
  findByUserId(userId: string): Promise<HandymanProfile | null>;

  /**
   * Return the handyman profile for a user, creating a default UNVERIFIED
   * profile if none exists yet. Idempotent and safe under concurrent
   * first-time reads (userId is unique).
   */
  ensureByUserId(userId: string): Promise<HandymanProfile>;

  /**
   * Find handyman profile by user ID with documents, categories, and user info
   */
  findByUserIdWithDetails(userId: string): Promise<HandymanProfile | null>;

  /**
   * Find handyman profile with documents, categories, and user info
   */
  findWithDocuments(id: string): Promise<HandymanProfile | null>;

  /**
   * Update verification status of a handyman profile
   */
  updateVerificationStatus(
    id: string,
    status: VerificationStatus,
    reviewedById?: string,
    rejectionReason?: string,
  ): Promise<HandymanProfile>;
}

export const HANDYMAN_PROFILE_REPOSITORY = Symbol('HANDYMAN_PROFILE_REPOSITORY');
