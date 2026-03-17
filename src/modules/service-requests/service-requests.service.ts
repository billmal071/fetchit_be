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
        applications: {
          include: {
            handymanProfile: {
              include: {
                user: {
                  select: { id: true, username: true, email: true, avatar: true, phone: true },
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

    return this.prisma.serviceRequestApplication.findMany({
      where: { serviceRequestId: requestId },
      include: {
        handymanProfile: {
          include: {
            user: {
              select: { id: true, username: true, email: true, avatar: true, phone: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Fix #1: Wrap in Prisma transaction to prevent race conditions
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

    // Atomic transaction: accept app, assign handyman, reject others
    const [, updatedRequest] = await this.prisma.$transaction([
      // Accept the application
      this.prisma.serviceRequestApplication.update({
        where: { id: appId },
        data: { status: ApplicationStatus.ACCEPTED },
      }),
      // Assign handyman and update request status
      this.prisma.serviceRequest.update({
        where: { id: requestId },
        data: {
          status: ServiceRequestStatus.ASSIGNED,
          assignedHandymanId: application.handymanProfileId,
        },
      }),
      // Reject all other pending applications
      this.prisma.serviceRequestApplication.updateMany({
        where: {
          serviceRequestId: requestId,
          status: ApplicationStatus.PENDING,
          id: { not: appId },
        },
        data: { status: ApplicationStatus.REJECTED },
      }),
    ]);

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

    return this.applicationRepo.update(appId, {
      status: ApplicationStatus.REJECTED,
    });
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
