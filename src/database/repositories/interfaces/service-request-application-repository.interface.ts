import { ServiceRequestApplication, Prisma } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Service Request Application Repository Interface
 *
 * Defines all data access operations for ServiceRequestApplication entity.
 */
export interface IServiceRequestApplicationRepository extends IBaseRepository<
  ServiceRequestApplication,
  Prisma.ServiceRequestApplicationCreateInput,
  Prisma.ServiceRequestApplicationUpdateInput
> {
  /**
   * Find all applications for a service request
   */
  findByRequestId(serviceRequestId: string): Promise<ServiceRequestApplication[]>;

  /**
   * Find all applications by a handyman profile
   */
  findByHandymanProfileId(handymanProfileId: string): Promise<ServiceRequestApplication[]>;

  /**
   * Find existing application by request ID and profile ID
   */
  findExisting(
    serviceRequestId: string,
    handymanProfileId: string,
  ): Promise<ServiceRequestApplication | null>;
}

export const SERVICE_REQUEST_APPLICATION_REPOSITORY = Symbol(
  'SERVICE_REQUEST_APPLICATION_REPOSITORY',
);
