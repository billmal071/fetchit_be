import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApplicationStatus, ServiceRequestStatus } from '@prisma/client';
import type { ServiceRequest, ServiceRequestApplication } from '@prisma/client';
import {
  SERVICE_REQUEST_REPOSITORY,
  IServiceRequestRepository,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
  IServiceRequestApplicationRepository,
} from '@/database/repositories';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS } from '@common/constants';
import { IPaginatedResult } from '@common/interfaces';
import { createPaginationMeta } from '@common/utils/pagination.util';
import {
  ResourceNotFoundException,
  ServiceRequestNotOpenException,
  ApplicationNotPendingException,
} from '@common/exceptions/domain.exception';
import { ForbiddenException } from '@common/exceptions/base.exception';
import {
  ServiceRequestCreatedEvent,
  ServiceRequestAssignedEvent,
  ServiceRequestCompletedEvent,
} from '@common/events';
import { CreateServiceRequestDto, UpdateServiceRequestDto, ServiceRequestQueryDto } from './dto';

@Injectable()
export class ServiceRequestsService {
  constructor(
    @Inject(SERVICE_REQUEST_REPOSITORY)
    private readonly requestRepo: IServiceRequestRepository,
    @Inject(SERVICE_REQUEST_APPLICATION_REPOSITORY)
    private readonly applicationRepo: IServiceRequestApplicationRepository,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateServiceRequestDto): Promise<ServiceRequest> {
    const request = await this.requestRepo.create({
      customer: { connect: { id: userId } },
      category: { connect: { id: dto.categoryId } },
      title: dto.title,
      description: dto.description,
      location: dto.location,
      latitude: dto.latitude,
      longitude: dto.longitude,
      budgetMin: dto.budgetMin,
      budgetMax: dto.budgetMax,
    });

    this.eventEmitter.emit(
      EVENTS.SERVICE_REQUEST_CREATED,
      new ServiceRequestCreatedEvent(request.id, userId, dto.categoryId, dto.title),
    );

    return request;
  }

  // Fix #3: Use Prisma directly to properly filter by status
  async findAll(userId: string, query: ServiceRequestQueryDto): Promise<IPaginatedResult<unknown>> {
    const where: { customerId: string; status?: ServiceRequestStatus } = { customerId: userId };

    if (query.status) {
      where.status = query.status;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const [data, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: query.sortBy
          ? { [query.sortBy]: query.sortOrder?.toLowerCase() as 'asc' | 'desc' }
          : { createdAt: 'desc' },
        include: {
          category: true,
          assignedHandyman: {
            include: {
              user: {
                select: { id: true, username: true, email: true, avatar: true, phone: true },
              },
            },
          },
          _count: { select: { applications: true } },
        },
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);

    return {
      data,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  // Fix #2: Add userId param and verify caller is customer, assigned handyman, or admin
  async findOne(id: string, userId: string, userRole: string): Promise<ServiceRequest> {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        category: true,
        customer: {
          select: { id: true, username: true, email: true, avatar: true, phone: true },
        },
        assignedHandyman: {
          include: {
            user: {
              select: { id: true, username: true, email: true, avatar: true, phone: true },
            },
          },
        },
        // Select, not include, on handymanProfile: `include` with no
        // `select` returns every scalar — bio/yearsOfExperience are fair to
        // show on an application, but location/latitude/longitude (precise
        // home coordinates) and rejectionReason (admin-authored KYC text,
        // never cleared on a later approval — see
        // HandymanProfileRepository.updateVerificationStatus) are not,
        // same reasoning as the email/phone leak this is fixing (bug #7).
        applications: {
          include: {
            handymanProfile: {
              select: {
                id: true,
                bio: true,
                yearsOfExperience: true,
                user: {
                  select: { id: true, username: true, avatar: true },
                },
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new ResourceNotFoundException('Service request', id);
    }

    // Allow: customer who owns it, assigned handyman, or admin
    const isCustomer = request.customerId === userId;
    const isAssignedHandyman = request.assignedHandyman?.userId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isCustomer && !isAssignedHandyman && !isAdmin) {
      throw new ForbiddenException('You do not have access to this service request');
    }

    return request;
  }

  async update(id: string, userId: string, dto: UpdateServiceRequestDto): Promise<ServiceRequest> {
    const request = await this.requestRepo.findById(id);

    if (!request) {
      throw new ResourceNotFoundException('Service request', id);
    }

    if (request.customerId !== userId) {
      throw new ForbiddenException('You can only update your own service requests');
    }

    if (request.status !== ServiceRequestStatus.OPEN) {
      throw new ServiceRequestNotOpenException();
    }

    return this.requestRepo.update(id, dto);
  }

  async cancel(id: string, userId: string): Promise<ServiceRequest> {
    const request = await this.requestRepo.findById(id);

    if (!request) {
      throw new ResourceNotFoundException('Service request', id);
    }

    if (request.customerId !== userId) {
      throw new ForbiddenException('You can only cancel your own service requests');
    }

    if (
      request.status === ServiceRequestStatus.COMPLETED ||
      request.status === ServiceRequestStatus.CANCELLED
    ) {
      throw new ForbiddenException('This service request cannot be cancelled');
    }

    return this.requestRepo.update(id, {
      status: ServiceRequestStatus.CANCELLED,
      cancelledAt: new Date(),
    });
  }

  async getApplications(requestId: string, userId: string): Promise<ServiceRequestApplication[]> {
    const request = await this.requestRepo.findById(requestId);

    if (!request) {
      throw new ResourceNotFoundException('Service request', requestId);
    }

    if (request.customerId !== userId) {
      throw new ForbiddenException('You can only view applications for your own service requests');
    }

    // Select, not include — see findOne's identical comment on why a bare
    // `include` on handymanProfile is its own leak (location/rejectionReason
    // and more, not just email/phone).
    return this.prisma.serviceRequestApplication.findMany({
      where: { serviceRequestId: requestId },
      include: {
        handymanProfile: {
          select: {
            id: true,
            bio: true,
            yearsOfExperience: true,
            user: {
              select: { id: true, username: true, avatar: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptApplication(
    requestId: string,
    appId: string,
    userId: string,
  ): Promise<ServiceRequest> {
    const request = await this.requestRepo.findById(requestId);

    if (!request) {
      throw new ResourceNotFoundException('Service request', requestId);
    }

    if (request.customerId !== userId) {
      throw new ForbiddenException(
        'You can only accept applications for your own service requests',
      );
    }

    if (request.status !== ServiceRequestStatus.OPEN) {
      throw new ServiceRequestNotOpenException();
    }

    const application = await this.applicationRepo.findById(appId);

    if (!application) {
      throw new ResourceNotFoundException('Application', appId);
    }

    if (application.serviceRequestId !== requestId) {
      throw new ResourceNotFoundException('Application', appId);
    }

    // Bug #5: a WITHDRAWN or REJECTED application could be accepted — nothing
    // checked the application's own status, only the request's.
    if (application.status !== ApplicationStatus.PENDING) {
      throw new ApplicationNotPendingException();
    }

    // The checks above read outside the transaction, so two concurrent
    // accepts could both pass them before either writes. The real guard is
    // these two conditional updates: `where` includes `status: OPEN`/
    // `PENDING`, so only the caller that wins each race matches any row. A
    // loser gets `count: 0` and the whole transaction rolls back before
    // touching anything else — previously the request update was
    // unconditional (both accepts "succeeded", leaving two ACCEPTED
    // applications on one request) and the application update never checked
    // status at all (a withdrawn/rejected application could still flip to
    // ACCEPTED if it raced a second accept call for the same request).
    const updatedRequest = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.serviceRequest.updateMany({
        where: { id: requestId, status: ServiceRequestStatus.OPEN },
        data: {
          status: ServiceRequestStatus.ASSIGNED,
          assignedHandymanId: application.handymanProfileId,
        },
      });

      if (count === 0) {
        throw new ServiceRequestNotOpenException();
      }

      const { count: appCount } = await tx.serviceRequestApplication.updateMany({
        where: { id: appId, status: ApplicationStatus.PENDING },
        data: { status: ApplicationStatus.ACCEPTED },
      });

      if (appCount === 0) {
        throw new ApplicationNotPendingException();
      }

      await tx.serviceRequestApplication.updateMany({
        where: {
          serviceRequestId: requestId,
          status: ApplicationStatus.PENDING,
          id: { not: appId },
        },
        data: { status: ApplicationStatus.REJECTED },
      });

      return tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    });

    this.eventEmitter.emit(
      EVENTS.SERVICE_REQUEST_ASSIGNED,
      new ServiceRequestAssignedEvent(requestId, application.handymanProfileId, userId),
    );

    return updatedRequest;
  }

  async rejectApplication(
    requestId: string,
    appId: string,
    userId: string,
  ): Promise<ServiceRequestApplication> {
    const request = await this.requestRepo.findById(requestId);

    if (!request) {
      throw new ResourceNotFoundException('Service request', requestId);
    }

    if (request.customerId !== userId) {
      throw new ForbiddenException(
        'You can only reject applications for your own service requests',
      );
    }

    const application = await this.applicationRepo.findById(appId);

    if (!application) {
      throw new ResourceNotFoundException('Application', appId);
    }

    if (application.serviceRequestId !== requestId) {
      throw new ResourceNotFoundException('Application', appId);
    }

    // Bug #6: rejected the application unconditionally — including one
    // already ACCEPTED, leaving the request ASSIGNED to a handyman whose
    // application now says REJECTED. Only a PENDING application on a
    // still-OPEN request may be rejected; the conditional update closes the
    // same TOCTOU gap as acceptApplication's guards (concurrent accept vs.
    // reject of the same application).
    if (request.status !== ServiceRequestStatus.OPEN) {
      throw new ServiceRequestNotOpenException();
    }

    if (application.status !== ApplicationStatus.PENDING) {
      throw new ApplicationNotPendingException();
    }

    const { count } = await this.prisma.serviceRequestApplication.updateMany({
      where: { id: appId, status: ApplicationStatus.PENDING },
      data: { status: ApplicationStatus.REJECTED },
    });

    if (count === 0) {
      throw new ApplicationNotPendingException();
    }

    return this.prisma.serviceRequestApplication.findUniqueOrThrow({ where: { id: appId } });
  }

  async confirmCompletion(requestId: string, userId: string): Promise<ServiceRequest> {
    const request = await this.requestRepo.findById(requestId);

    if (!request) {
      throw new ResourceNotFoundException('Service request', requestId);
    }

    if (request.customerId !== userId) {
      throw new ForbiddenException('You can only confirm completion of your own service requests');
    }

    if (request.status !== ServiceRequestStatus.IN_PROGRESS) {
      throw new ForbiddenException('Only in-progress service requests can be marked as completed');
    }

    const updatedRequest = await this.requestRepo.update(requestId, {
      status: ServiceRequestStatus.COMPLETED,
      completedAt: new Date(),
    });

    this.eventEmitter.emit(
      EVENTS.SERVICE_REQUEST_COMPLETED,
      new ServiceRequestCompletedEvent(requestId, request.assignedHandymanId!, userId),
    );

    return updatedRequest;
  }
}
