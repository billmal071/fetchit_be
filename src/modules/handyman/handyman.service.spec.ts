import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ServiceRequestStatus, VerificationStatus } from '@prisma/client';
import { HandymanService } from './handyman.service';
import {
  HANDYMAN_PROFILE_REPOSITORY,
  HANDYMAN_DOCUMENT_REPOSITORY,
  SERVICE_REQUEST_REPOSITORY,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
} from '@/database/repositories';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS } from '@common/constants';
import {
  HandymanProfileNotFoundException,
  HandymanNotVerifiedException,
  InvalidVerificationTransitionException,
  DuplicateApplicationException,
  ServiceRequestNotOpenException,
  ResourceNotFoundException,
} from '@common/exceptions/domain.exception';
import { ForbiddenException } from '@common/exceptions/base.exception';

describe('HandymanService', () => {
  let service: HandymanService;
  let mockProfileRepo: Record<string, jest.Mock>;
  let mockDocumentRepo: Record<string, jest.Mock>;
  let mockServiceRequestRepo: Record<string, jest.Mock>;
  let mockApplicationRepo: Record<string, jest.Mock>;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;
  let mockEventEmitter: { emit: jest.Mock };

  const userId = 'user-1';
  const profileId = 'profile-1';

  const mockProfile = {
    id: profileId,
    userId,
    bio: 'Experienced plumber',
    location: 'Lagos',
    latitude: 6.5,
    longitude: 3.4,
    hourlyRate: 5000,
    yearsOfExperience: 5,
    verificationStatus: VerificationStatus.UNVERIFIED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDocument = {
    id: 'doc-1',
    handymanProfileId: profileId,
    type: 'GOVERNMENT_ID',
    fileUrl: 'https://example.com/doc.pdf',
    fileName: 'id-card.pdf',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockServiceRequest = {
    id: 'req-1',
    customerId: 'customer-1',
    assignedHandymanId: profileId,
    status: ServiceRequestStatus.ASSIGNED,
    title: 'Fix sink',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockProfileRepo = {
      findByUserId: jest.fn(),
      findByUserIdWithDetails: jest.fn(),
      ensureByUserId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateVerificationStatus: jest.fn(),
    };

    mockDocumentRepo = {
      findById: jest.fn(),
      findByProfileId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteByIdAndProfileId: jest.fn(),
    };

    mockServiceRequestRepo = {
      findById: jest.fn(),
      countByHandymanAndStatus: jest.fn(),
      update: jest.fn(),
    };

    mockApplicationRepo = {
      findById: jest.fn(),
      findExisting: jest.fn(),
      findByHandymanProfileId: jest.fn(),
      create: jest.fn(),
    };

    mockPrisma = {
      user: { findUniqueOrThrow: jest.fn() },
      handymanProfile: { update: jest.fn() },
      serviceRequest: { findMany: jest.fn(), count: jest.fn() },
    };

    mockEventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandymanService,
        { provide: HANDYMAN_PROFILE_REPOSITORY, useValue: mockProfileRepo },
        { provide: HANDYMAN_DOCUMENT_REPOSITORY, useValue: mockDocumentRepo },
        { provide: SERVICE_REQUEST_REPOSITORY, useValue: mockServiceRequestRepo },
        { provide: SERVICE_REQUEST_APPLICATION_REPOSITORY, useValue: mockApplicationRepo },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<HandymanService>(HandymanService);
  });

  describe('getDashboard', () => {
    it('should return profile and stats', async () => {
      mockProfileRepo.ensureByUserId.mockResolvedValue(mockProfile);
      // Call order: ASSIGNED (1st), COMPLETED (2nd via Promise.all), IN_PROGRESS (3rd inside .then)
      mockServiceRequestRepo.countByHandymanAndStatus
        .mockResolvedValueOnce(2) // ASSIGNED
        .mockResolvedValueOnce(5) // COMPLETED
        .mockResolvedValueOnce(1); // IN_PROGRESS (inside .then chained on ASSIGNED)

      const result = await service.getDashboard(userId);

      expect(result.profile).toEqual(mockProfile);
      expect(result.stats.ongoingCount).toBe(3); // assigned + in_progress
      expect(result.stats.completedCount).toBe(5);
    });

    it('should lazily create a default profile when none exists', async () => {
      const defaultProfile = { ...mockProfile, verificationStatus: VerificationStatus.UNVERIFIED };
      mockProfileRepo.ensureByUserId.mockResolvedValue(defaultProfile);
      mockServiceRequestRepo.countByHandymanAndStatus
        .mockResolvedValueOnce(0) // ASSIGNED
        .mockResolvedValueOnce(0) // COMPLETED
        .mockResolvedValueOnce(0); // IN_PROGRESS

      const result = await service.getDashboard(userId);

      expect(mockProfileRepo.ensureByUserId).toHaveBeenCalledWith(userId);
      expect(result.profile).toEqual(defaultProfile);
      expect(result.stats.ongoingCount).toBe(0);
      expect(result.stats.completedCount).toBe(0);
    });
  });

  describe('getProfile', () => {
    it('should return profile with details when found', async () => {
      mockProfileRepo.findByUserIdWithDetails.mockResolvedValue(mockProfile);

      const result = await service.getProfile(userId);

      expect(result).toEqual(mockProfile);
      expect(mockProfileRepo.findByUserIdWithDetails).toHaveBeenCalledWith(userId);
    });

    it('should lazily create and return a default profile when none exists', async () => {
      const defaultProfile = { ...mockProfile, verificationStatus: VerificationStatus.UNVERIFIED };
      // First lookup misses, then returns the freshly-created row.
      mockProfileRepo.findByUserIdWithDetails
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(defaultProfile);
      mockProfileRepo.ensureByUserId.mockResolvedValue(defaultProfile);

      const result = await service.getProfile(userId);

      expect(mockProfileRepo.ensureByUserId).toHaveBeenCalledWith(userId);
      expect(result).toEqual(defaultProfile);
    });
  });

  describe('completeProfile', () => {
    const dto = {
      bio: 'Experienced plumber',
      location: 'Lagos',
      latitude: 6.5,
      longitude: 3.4,
      hourlyRate: 5000,
      yearsOfExperience: 5,
      categoryIds: ['cat-1', 'cat-2'],
    };

    it('should create new profile with PROFILE_COMPLETE status', async () => {
      mockProfileRepo.findByUserId.mockResolvedValue(null);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'test@example.com' });
      const createdProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
      };
      mockProfileRepo.create.mockResolvedValue(createdProfile);

      const result = await service.completeProfile(userId, dto);

      expect(result).toEqual(createdProfile);
      expect(mockProfileRepo.create).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.HANDYMAN_PROFILE_COMPLETED,
        expect.objectContaining({ userId }),
      );
    });

    it('should update existing UNVERIFIED profile', async () => {
      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'test@example.com' });
      const updatedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
      };
      mockPrisma.handymanProfile.update.mockResolvedValue(updatedProfile);

      const result = await service.completeProfile(userId, dto);

      expect(result).toEqual(updatedProfile);
      expect(mockPrisma.handymanProfile.update).toHaveBeenCalled();
    });

    it('should throw on invalid status transition', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      mockProfileRepo.findByUserId.mockResolvedValue(verifiedProfile);

      await expect(service.completeProfile(userId, dto)).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });
  });

  describe('uploadDocument', () => {
    const dto = {
      type: 'GOVERNMENT_ID' as const,
      fileUrl: 'https://example.com/doc.pdf',
      fileName: 'id-card.pdf',
    };

    it('should create document when profile exists', async () => {
      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockDocumentRepo.create.mockResolvedValue(mockDocument);

      const result = await service.uploadDocument(userId, dto);

      expect(result).toEqual(mockDocument);
      expect(mockDocumentRepo.create).toHaveBeenCalledWith({
        handymanProfile: { connect: { id: profileId } },
        type: dto.type,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName,
      });
    });

    it('should throw when profile not found', async () => {
      mockProfileRepo.findByUserId.mockResolvedValue(null);

      await expect(service.uploadDocument(userId, dto)).rejects.toThrow(
        HandymanProfileNotFoundException,
      );
    });
  });

  describe('deleteDocument', () => {
    it('should delete document when profile exists and not under review', async () => {
      const profileComplete = {
        ...mockProfile,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
      };
      mockProfileRepo.findByUserId.mockResolvedValue(profileComplete);

      await service.deleteDocument(userId, 'doc-1');

      expect(mockDocumentRepo.deleteByIdAndProfileId).toHaveBeenCalledWith('doc-1', profileId);
    });

    it('should throw when profile not found', async () => {
      mockProfileRepo.findByUserId.mockResolvedValue(null);

      await expect(service.deleteDocument(userId, 'doc-1')).rejects.toThrow(
        HandymanProfileNotFoundException,
      );
    });

    it('should throw ForbiddenException when status is DOCUMENTS_SUBMITTED', async () => {
      const submittedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.DOCUMENTS_SUBMITTED,
      };
      mockProfileRepo.findByUserId.mockResolvedValue(submittedProfile);

      await expect(service.deleteDocument(userId, 'doc-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('submitDocuments', () => {
    it('should transition to DOCUMENTS_SUBMITTED when valid', async () => {
      const profileComplete = {
        ...mockProfile,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
      };
      const submittedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.DOCUMENTS_SUBMITTED,
      };
      mockProfileRepo.findByUserId.mockResolvedValue(profileComplete);
      mockDocumentRepo.findByProfileId.mockResolvedValue([mockDocument]);
      mockProfileRepo.updateVerificationStatus.mockResolvedValue(submittedProfile);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'test@example.com' });

      const result = await service.submitDocuments(userId);

      expect(result).toEqual(submittedProfile);
      expect(mockProfileRepo.updateVerificationStatus).toHaveBeenCalledWith(
        profileId,
        VerificationStatus.DOCUMENTS_SUBMITTED,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.HANDYMAN_DOCUMENTS_SUBMITTED,
        expect.objectContaining({ userId }),
      );
    });

    it('should throw on invalid status transition', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      mockProfileRepo.findByUserId.mockResolvedValue(verifiedProfile);

      await expect(service.submitDocuments(userId)).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });

    it('should throw when no documents uploaded', async () => {
      const profileComplete = {
        ...mockProfile,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
      };
      mockProfileRepo.findByUserId.mockResolvedValue(profileComplete);
      mockDocumentRepo.findByProfileId.mockResolvedValue([]);

      await expect(service.submitDocuments(userId)).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });
  });

  describe('applyToRequest', () => {
    const dto = { coverMessage: 'I can help', proposedRate: 5000 };

    it('should create application when valid', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      const openRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.OPEN,
      };
      const mockApplication = {
        id: 'app-1',
        serviceRequestId: 'req-1',
        handymanProfileId: profileId,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(verifiedProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(openRequest);
      mockApplicationRepo.findExisting.mockResolvedValue(null);
      mockApplicationRepo.create.mockResolvedValue(mockApplication);

      const result = await service.applyToRequest(userId, 'req-1', dto);

      expect(result).toEqual(mockApplication);
    });

    it('should throw HandymanNotVerifiedException when not verified', async () => {
      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile); // UNVERIFIED

      await expect(service.applyToRequest(userId, 'req-1', dto)).rejects.toThrow(
        HandymanNotVerifiedException,
      );
    });

    it('should throw DuplicateApplicationException on duplicate', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      const openRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.OPEN,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(verifiedProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(openRequest);
      mockApplicationRepo.findExisting.mockResolvedValue({ id: 'existing-app' });

      await expect(service.applyToRequest(userId, 'req-1', dto)).rejects.toThrow(
        DuplicateApplicationException,
      );
    });

    it('should throw ServiceRequestNotOpenException when request not OPEN', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      const assignedRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.ASSIGNED,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(verifiedProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(assignedRequest);

      await expect(service.applyToRequest(userId, 'req-1', dto)).rejects.toThrow(
        ServiceRequestNotOpenException,
      );
    });
  });

  describe('startRequest', () => {
    it('should transition to IN_PROGRESS when assigned to handyman', async () => {
      const assignedRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.ASSIGNED,
        assignedHandymanId: profileId,
      };
      const inProgressRequest = {
        ...assignedRequest,
        status: ServiceRequestStatus.IN_PROGRESS,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(assignedRequest);
      mockServiceRequestRepo.update.mockResolvedValue(inProgressRequest);

      const result = await service.startRequest(userId, 'req-1');

      expect(result).toEqual(inProgressRequest);
      expect(mockServiceRequestRepo.update).toHaveBeenCalledWith('req-1', {
        status: ServiceRequestStatus.IN_PROGRESS,
      });
    });

    it('should throw when not assigned to this handyman', async () => {
      const request = {
        ...mockServiceRequest,
        assignedHandymanId: 'other-profile',
        status: ServiceRequestStatus.ASSIGNED,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(request);

      await expect(service.startRequest(userId, 'req-1')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw on invalid status transition', async () => {
      const completedRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.COMPLETED,
        assignedHandymanId: profileId,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(completedRequest);

      await expect(service.startRequest(userId, 'req-1')).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });
  });

  describe('completeRequest', () => {
    it('should transition to COMPLETED and emit event', async () => {
      const inProgressRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.IN_PROGRESS,
        assignedHandymanId: profileId,
        customerId: 'customer-1',
      };
      const completedRequest = {
        ...inProgressRequest,
        status: ServiceRequestStatus.COMPLETED,
        completedAt: expect.any(Date),
      };

      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(inProgressRequest);
      mockServiceRequestRepo.update.mockResolvedValue(completedRequest);

      const result = await service.completeRequest(userId, 'req-1');

      expect(result).toEqual(completedRequest);
      expect(mockServiceRequestRepo.update).toHaveBeenCalledWith('req-1', {
        status: ServiceRequestStatus.COMPLETED,
        completedAt: expect.any(Date),
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.SERVICE_REQUEST_COMPLETED,
        expect.objectContaining({
          serviceRequestId: 'req-1',
          handymanProfileId: profileId,
          customerId: 'customer-1',
        }),
      );
    });

    it('should throw when not assigned to this handyman', async () => {
      const request = {
        ...mockServiceRequest,
        assignedHandymanId: 'other-profile',
        status: ServiceRequestStatus.IN_PROGRESS,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(request);

      await expect(service.completeRequest(userId, 'req-1')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw on invalid status transition', async () => {
      const assignedRequest = {
        ...mockServiceRequest,
        status: ServiceRequestStatus.ASSIGNED,
        assignedHandymanId: profileId,
      };

      mockProfileRepo.findByUserId.mockResolvedValue(mockProfile);
      mockServiceRequestRepo.findById.mockResolvedValue(assignedRequest);

      await expect(service.completeRequest(userId, 'req-1')).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });
  });
});
