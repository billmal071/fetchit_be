import { ServiceRequest, Prisma, ServiceRequestStatus } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Service Request Repository Interface
 *
 * Defines all data access operations for ServiceRequest entity.
 */
export interface IServiceRequestRepository extends IBaseRepository<
  ServiceRequest,
  Prisma.ServiceRequestCreateInput,
  Prisma.ServiceRequestUpdateInput
> {
  /**
   * Find service requests by customer ID with pagination
   */
  findByCustomerId(
    customerId: string,
    options?: { skip?: number; take?: number; orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<ServiceRequest[]>;

  /**
   * Find service requests assigned to a handyman by their profile ID with pagination
   */
  findByHandymanId(
    handymanProfileId: string,
    options?: { skip?: number; take?: number; orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<ServiceRequest[]>;

  /**
   * Find open service requests with pagination
   */
  findOpenRequests(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<ServiceRequest[]>;

  /**
   * Count service requests by handyman profile ID and status
   */
  countByHandymanAndStatus(
    handymanProfileId: string,
    status: ServiceRequestStatus,
  ): Promise<number>;
}

export const SERVICE_REQUEST_REPOSITORY = Symbol('SERVICE_REQUEST_REPOSITORY');
