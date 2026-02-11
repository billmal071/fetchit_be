import { Waitlist, Prisma, WaitlistRole } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Waitlist Repository Interface
 */
export interface IWaitlistRepository extends IBaseRepository<
  Waitlist,
  Prisma.WaitlistCreateInput,
  Prisma.WaitlistUpdateInput
> {
  /**
   * Find waitlist entry by email
   */
  findByEmail(email: string): Promise<Waitlist | null>;

  /**
   * Check if email exists in waitlist
   */
  emailExists(email: string): Promise<boolean>;

  /**
   * Find all entries by role
   */
  findByRole(
    role: WaitlistRole,
    options?: {
      skip?: number;
      take?: number;
      orderBy?: Record<string, 'asc' | 'desc'>;
    },
  ): Promise<Waitlist[]>;

  /**
   * Count entries by role
   */
  countByRole(role: WaitlistRole): Promise<number>;
}

export const WAITLIST_REPOSITORY = Symbol('WAITLIST_REPOSITORY');
