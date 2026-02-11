import { PasswordReset, Prisma, User } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Password Reset with User relation
 */
export type PasswordResetWithUser = PasswordReset & { user: User };

/**
 * Password Reset Repository Interface
 */
export interface IPasswordResetRepository extends IBaseRepository<
  PasswordReset,
  Prisma.PasswordResetCreateInput,
  Prisma.PasswordResetUpdateInput
> {
  /**
   * Find password reset by token
   */
  findByToken(token: string): Promise<PasswordReset | null>;

  /**
   * Find password reset by token with user relation
   */
  findByTokenWithUser(token: string): Promise<PasswordResetWithUser | null>;

  /**
   * Find valid (non-expired, unused) password reset by token
   */
  findValidByToken(token: string): Promise<PasswordReset | null>;

  /**
   * Mark token as used
   */
  markAsUsed(id: string): Promise<void>;

  /**
   * Invalidate all unused tokens for a user (mark as used)
   */
  invalidateUserTokens(userId: string): Promise<void>;

  /**
   * Reset password and mark token as used atomically
   */
  resetPasswordWithToken(tokenId: string, userId: string, hashedPassword: string): Promise<void>;

  /**
   * Delete all password reset tokens for a user
   */
  deleteByUserId(userId: string): Promise<void>;

  /**
   * Delete expired tokens (cleanup)
   */
  deleteExpired(): Promise<number>;
}

export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY');
