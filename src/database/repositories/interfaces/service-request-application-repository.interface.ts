import { ServiceRequestApplication, Prisma } from '@prisma/client';
import { IBaseRepository } from './base-repository.interface';

/**
 * Service Request Application Repository Interface
 *
 * Defines all data access operations for ServiceRequestApplication entity.
 */
/**
 * Relations loaded with each application on the handyman "my applications"
 * list. The customer select deliberately matches the browse feed (no
 * email/phone): an application may be pending, rejected or withdrawn, i.e. the
 * handyman is not (or no longer) hired for the request, so contact details
 * must not be exposed here.
 */
export const HANDYMAN_APPLICATION_INCLUDE = {
  serviceRequest: {
    include: {
      category: true,
      customer: { select: { id: true, username: true, avatar: true } },
      _count: { select: { applications: true } },
    },
  },
} satisfies Prisma.ServiceRequestApplicationInclude;

export type ApplicationWithServiceRequest = Prisma.ServiceRequestApplicationGetPayload<{
  include: typeof HANDYMAN_APPLICATION_INCLUDE;
}>;

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
   * Find all applications by a handyman profile, each with its service
   * request (category, restricted customer, application count) included.
   */
  findByHandymanProfileId(handymanProfileId: string): Promise<ApplicationWithServiceRequest[]>;

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
