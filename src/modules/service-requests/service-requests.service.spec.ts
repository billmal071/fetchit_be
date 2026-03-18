import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApplicationStatus, ServiceRequestStatus } from '@prisma/client';
import { ServiceRequestsService } from './service-requests.service';
import {
  SERVICE_REQUEST_REPOSITORY,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
} from '@/database/repositories';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS } from '@common/constants';
import {
  ResourceNotFoundException,
  ServiceRequestNotOpenException,
} from '@common/exceptions/domain.exception';
import { ForbiddenException } from '@common/exceptions/base.exception';

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;
  let mockRequestRepo: Record<string, jest.Mock>;
  let mockApplicationRepo: Record<string, jest.Mock>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any;
  let mockEventEmitter: { emit: jest.Mock };

  const userId = 'user-1';
  const otherUserId = 'user-2';
  const requestId = 'req-1';
  const appId = 'app-1';

  const mockRequest = {
    id: requestId,
    customerId: userId,
    categoryId: 'cat-1',
    title: 'Fix my sink',
    description: 'Kitchen sink is leaking',
    location: 'Lagos',
    latitude: 6.5,
    longitude: 3.4,
    budgetMin: 5000,
    budgetMax: 10000,
    status: ServiceRequestStatus.OPEN,
    assignedHandymanId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockApplication = {
    id: appId,
    serviceRequestId: requestId,
    handymanProfileId: 'profile-1',
    coverMessage: 'I can help',
    proposedRate: 7000,
    status: ApplicationStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRequestRepo = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByCustomerId: jest.fn(),
    };

    mockApplicationRepo = {
      findById: jest.fn(),
      findByRequestId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockPrisma = {
      serviceRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      serviceRequestApplication: {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    mockEventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestsService,
        { provide: SERVICE_REQUEST_REPOSITORY, useValue: mockRequestRepo },
        { provide: SERVICE_REQUEST_APPLICATION_REPOSITORY, useValue: mockApplicationRepo },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ServiceRequestsService>(ServiceRequestsService);
  });

  describe('create', () => {
    it('should create service request and emit event', async () => {
      const dto = {
        categoryId: 'cat-1',
        title: 'Fix my sink',
        description: 'Kitchen sink is leaking',
        location: 'Lagos',
        latitude: 6.5,
        longitude: 3.4,
        budgetMin: 5000,
        budgetMax: 10000,
      };
      mockRequestRepo.create.mockResolvedValue(mockRequest);

      const result = await service.create(userId, dto);

      expect(result).toEqual(mockRequest);
      expect(mockRequestRepo.create).toHaveBeenCalledWith({
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
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.SERVICE_REQUEST_CREATED,
        expect.objectContaining({
          serviceRequestId: requestId,
          customerId: userId,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return request for the customer who owns it', async () => {
      const requestWithIncludes = {
        ...mockRequest,
        customer: { id: userId },
        assignedHandyman: null,
        applications: [],
      };
      mockPrisma.serviceRequest.findUnique.mockResolvedValue(requestWithIncludes);

      const result = await service.findOne(requestId, userId, 'USER');

      expect(result).toEqual(requestWithIncludes);
    });

    it('should throw ResourceNotFoundException when not found', async () => {
      mockPrisma.serviceRequest.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', userId, 'USER')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ForbiddenException for unauthorized user', async () => {
      const requestWithIncludes = {
        ...mockRequest,
        customer: { id: userId },
        assignedHandyman: null,
        applications: [],
      };
      mockPrisma.serviceRequest.findUnique.mockResolvedValue(requestWithIncludes);

      await expect(service.findOne(requestId, otherUserId, 'USER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow admin to view any request', async () => {
      const requestWithIncludes = {
        ...mockRequest,
        customer: { id: userId },
        assignedHandyman: null,
        applications: [],
      };
      mockPrisma.serviceRequest.findUnique.mockResolvedValue(requestWithIncludes);

      const result = await service.findOne(requestId, otherUserId, 'ADMIN');

      expect(result).toEqual(requestWithIncludes);
    });
  });

  describe('update', () => {
    it('should update when request is OPEN and user is owner', async () => {
      const dto = { title: 'Updated title' };
      const updated = { ...mockRequest, title: 'Updated title' };
      mockRequestRepo.findById.mockResolvedValue(mockRequest);
      mockRequestRepo.update.mockResolvedValue(updated);

      const result = await service.update(requestId, userId, dto);

      expect(result).toEqual(updated);
      expect(mockRequestRepo.update).toHaveBeenCalledWith(requestId, dto);
    });

    it('should throw ResourceNotFoundException when not found', async () => {
      mockRequestRepo.findById.mockResolvedValue(null);

      await expect(service.update('nonexistent', userId, { title: 'test' })).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ForbiddenException when not the owner', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest);

      await expect(service.update(requestId, otherUserId, { title: 'test' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ServiceRequestNotOpenException when not OPEN', async () => {
      const assignedRequest = { ...mockRequest, status: ServiceRequestStatus.ASSIGNED };
      mockRequestRepo.findById.mockResolvedValue(assignedRequest);

      await expect(service.update(requestId, userId, { title: 'test' })).rejects.toThrow(
        ServiceRequestNotOpenException,
      );
    });
  });

  describe('cancel', () => {
    it('should cancel with timestamp when OPEN', async () => {
      const cancelled = {
        ...mockRequest,
        status: ServiceRequestStatus.CANCELLED,
        cancelledAt: expect.any(Date),
      };
      mockRequestRepo.findById.mockResolvedValue(mockRequest);
      mockRequestRepo.update.mockResolvedValue(cancelled);

      const result = await service.cancel(requestId, userId);

      expect(result).toEqual(cancelled);
      expect(mockRequestRepo.update).toHaveBeenCalledWith(requestId, {
        status: ServiceRequestStatus.CANCELLED,
        cancelledAt: expect.any(Date),
      });
    });

    it('should throw ForbiddenException on COMPLETED request', async () => {
      const completed = { ...mockRequest, status: ServiceRequestStatus.COMPLETED };
      mockRequestRepo.findById.mockResolvedValue(completed);

      await expect(service.cancel(requestId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException on CANCELLED request', async () => {
      const cancelled = { ...mockRequest, status: ServiceRequestStatus.CANCELLED };
      mockRequestRepo.findById.mockResolvedValue(cancelled);

      await expect(service.cancel(requestId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when not the owner', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest);

      await expect(service.cancel(requestId, otherUserId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('acceptApplication', () => {
    it('should use transaction, reject other apps, and emit event', async () => {
      const updatedRequest = {
        ...mockRequest,
        status: ServiceRequestStatus.ASSIGNED,
        assignedHandymanId: 'profile-1',
      };

      mockRequestRepo.findById.mockResolvedValue(mockRequest);
      mockApplicationRepo.findById.mockResolvedValue(mockApplication);
      mockPrisma.$transaction.mockResolvedValue([
        { ...mockApplication, status: ApplicationStatus.ACCEPTED },
        updatedRequest,
        { count: 2 },
      ]);

      const result = await service.acceptApplication(requestId, appId, userId);

      expect(result).toEqual(updatedRequest);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.SERVICE_REQUEST_ASSIGNED,
        expect.objectContaining({
          serviceRequestId: requestId,
          handymanProfileId: 'profile-1',
        }),
      );
    });

    it('should throw ForbiddenException when not the owner', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest);

      await expect(service.acceptApplication(requestId, appId, otherUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ServiceRequestNotOpenException when not OPEN', async () => {
      const assigned = { ...mockRequest, status: ServiceRequestStatus.ASSIGNED };
      mockRequestRepo.findById.mockResolvedValue(assigned);

      await expect(service.acceptApplication(requestId, appId, userId)).rejects.toThrow(
        ServiceRequestNotOpenException,
      );
    });

    it('should throw ResourceNotFoundException when application not found', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest);
      mockApplicationRepo.findById.mockResolvedValue(null);

      await expect(service.acceptApplication(requestId, appId, userId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('rejectApplication', () => {
    it('should reject the application', async () => {
      const rejected = { ...mockApplication, status: ApplicationStatus.REJECTED };
      mockRequestRepo.findById.mockResolvedValue(mockRequest);
      mockApplicationRepo.findById.mockResolvedValue(mockApplication);
      mockApplicationRepo.update.mockResolvedValue(rejected);

      const result = await service.rejectApplication(requestId, appId, userId);

      expect(result).toEqual(rejected);
      expect(mockApplicationRepo.update).toHaveBeenCalledWith(appId, {
        status: ApplicationStatus.REJECTED,
      });
    });

    it('should throw ForbiddenException when not the owner', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest);

      await expect(service.rejectApplication(requestId, appId, otherUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ResourceNotFoundException when application not found', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest);
      mockApplicationRepo.findById.mockResolvedValue(null);

      await expect(service.rejectApplication(requestId, appId, userId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('confirmCompletion', () => {
    it('should complete with timestamp and emit event', async () => {
      const inProgress = {
        ...mockRequest,
        status: ServiceRequestStatus.IN_PROGRESS,
        assignedHandymanId: 'profile-1',
      };
      const completed = {
        ...inProgress,
        status: ServiceRequestStatus.COMPLETED,
        completedAt: expect.any(Date),
      };
      mockRequestRepo.findById.mockResolvedValue(inProgress);
      mockRequestRepo.update.mockResolvedValue(completed);

      const result = await service.confirmCompletion(requestId, userId);

      expect(result).toEqual(completed);
      expect(mockRequestRepo.update).toHaveBeenCalledWith(requestId, {
        status: ServiceRequestStatus.COMPLETED,
        completedAt: expect.any(Date),
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.SERVICE_REQUEST_COMPLETED,
        expect.objectContaining({
          serviceRequestId: requestId,
          handymanProfileId: 'profile-1',
          customerId: userId,
        }),
      );
    });

    it('should throw ForbiddenException when not IN_PROGRESS', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockRequest); // status is OPEN

      await expect(service.confirmCompletion(requestId, userId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when not the owner', async () => {
      const inProgress = {
        ...mockRequest,
        status: ServiceRequestStatus.IN_PROGRESS,
      };
      mockRequestRepo.findById.mockResolvedValue(inProgress);

      await expect(service.confirmCompletion(requestId, otherUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ResourceNotFoundException when request not found', async () => {
      mockRequestRepo.findById.mockResolvedValue(null);

      await expect(service.confirmCompletion('nonexistent', userId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });
});
