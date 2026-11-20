import type { ExtraService, ShoppingCategory, ShoppingLocation } from '@prisma/client';

/**
 * Shopping Reference Repository Interface
 *
 * The admin-editable lookups the shopper onboarding form is built from. Only
 * active rows are ever listed or accepted.
 */
export interface IShoppingReferenceRepository {
  listCategories(): Promise<ShoppingCategory[]>;
  listLocations(): Promise<ShoppingLocation[]>;
  listServices(): Promise<ExtraService[]>;

  /** The subset of `ids` that exist and are active. */
  findActiveCategoryIds(ids: string[]): Promise<string[]>;
  findActiveLocationIds(ids: string[]): Promise<string[]>;
  findActiveServiceIds(ids: string[]): Promise<string[]>;
}

export const SHOPPING_REFERENCE_REPOSITORY = Symbol('SHOPPING_REFERENCE_REPOSITORY');
