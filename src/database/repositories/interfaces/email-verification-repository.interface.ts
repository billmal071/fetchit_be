import { EmailVerification, Prisma, User } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Email Verification with User relation
 */
export type EmailVerificationWithUser = EmailVerification & { user: User };

/**
 * Email Verification Repository Interface
 */
export interface IEmailVerificationRepository extends IBaseRepository<
  EmailVerification,
  Prisma.EmailVerificationCreateInput,
  Prisma.EmailVerificationUpdateInput
> {
  /**
   * Find email verification by token
   */
  findByToken(token: string): Promise<EmailVerification | null>;

  /**
   * Find email verification by token with user relation
   */
  findByTokenWithUser(token: string): Promise<EmailVerificationWithUser | null>;

  /**
   * Find valid (non-expired, unused) verification by token
   */
  findValidByToken(token: string): Promise<EmailVerification | null>;

  /**
   * Mark token as used
   */
  markAsUsed(id: string): Promise<void>;

  /**
   * Invalidate all unused tokens for a user (mark as used)
   */
  invalidateUserTokens(userId: string): Promise<void>;

  /**
   * Verify email and activate user atomically
   * Marks the token as used and updates user's emailVerified status
   */
  verifyAndActivateUser(tokenId: string, userId: string): Promise<void>;

  /**
   * Delete all verification tokens for a user
   */
  deleteByUserId(userId: string): Promise<void>;

  /**
   * Delete expired tokens (cleanup)
   */
  deleteExpired(): Promise<number>;
}

export const EMAIL_VERIFICATION_REPOSITORY = Symbol('EMAIL_VERIFICATION_REPOSITORY');
