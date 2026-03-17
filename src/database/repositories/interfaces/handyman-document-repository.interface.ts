import { HandymanDocument, Prisma } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Handyman Document Repository Interface
 *
 * Defines all data access operations for HandymanDocument entity.
 */
export interface IHandymanDocumentRepository extends IBaseRepository<
  HandymanDocument,
  Prisma.HandymanDocumentCreateInput,
  Prisma.HandymanDocumentUpdateInput
> {
  /**
   * Find all documents for a handyman profile
   */
  findByProfileId(handymanProfileId: string): Promise<HandymanDocument[]>;

  /**
   * Delete a document by ID and profile ID (ensures ownership)
   */
  deleteByIdAndProfileId(id: string, handymanProfileId: string): Promise<void>;
}

export const HANDYMAN_DOCUMENT_REPOSITORY = Symbol('HANDYMAN_DOCUMENT_REPOSITORY');
