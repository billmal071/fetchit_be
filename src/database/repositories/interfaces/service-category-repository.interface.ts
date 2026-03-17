import { ServiceCategory, Prisma } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Service Category Repository Interface
 *
 * Defines all data access operations for ServiceCategory entity.
 */
export interface IServiceCategoryRepository extends IBaseRepository<
  ServiceCategory,
  Prisma.ServiceCategoryCreateInput,
  Prisma.ServiceCategoryUpdateInput
> {
  /**
   * Find all active service categories
   */
  findActive(): Promise<ServiceCategory[]>;

  /**
   * Find service category by slug
   */
  findBySlug(slug: string): Promise<ServiceCategory | null>;
}

export const SERVICE_CATEGORY_REPOSITORY = Symbol('SERVICE_CATEGORY_REPOSITORY');
