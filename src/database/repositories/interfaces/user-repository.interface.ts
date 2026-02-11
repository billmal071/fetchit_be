import { User, Prisma } from '@prisma/client';
import { ISoftDeleteRepository } from './base-repository.interface';

/**
 * User Repository Interface
 *
 * Defines all data access operations for User entity.
 * This abstraction allows for easy testing and potential
 * database provider swapping.
 */
export interface IUserRepository extends ISoftDeleteRepository<
  User,
  Prisma.UserCreateInput,
  Prisma.UserUpdateInput
> {
  /**
   * Find user by email
   */
  findByEmail(email: string): Promise<User | null>;

  /**
   * Find user by username
   */
  findByUsername(username: string): Promise<User | null>;

  /**
   * Find user by Google ID (OAuth)
   */
  findByGoogleId(googleId: string): Promise<User | null>;

  /**
   * Update user's refresh token
   */
  updateRefreshToken(id: string, refreshToken: string | null): Promise<void>;

  /**
   * Update user's last login timestamp
   */
  updateLastLogin(id: string): Promise<void>;

  /**
   * Update user's password
   */
  updatePassword(id: string, hashedPassword: string): Promise<void>;

  /**
   * Update user's email verification status
   */
  updateEmailVerified(id: string, verified: boolean): Promise<void>;

  /**
   * Check if email exists
   */
  emailExists(email: string): Promise<boolean>;

  /**
   * Check if username exists
   */
  usernameExists(username: string): Promise<boolean>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
