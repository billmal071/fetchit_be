import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerificationStatus } from '@prisma/client';
import { AdminVerificationService } from './admin-verification.service';
import { HANDYMAN_PROFILE_REPOSITORY, HANDYMAN_DOCUMENT_REPOSITORY } from '@/database/repositories';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@common/services/audit.service';
import { StorageService } from '@/storage';
import { EVENTS } from '@common/constants';
import {
  ResourceNotFoundException,
  InvalidVerificationTransitionException,
} from '@common/exceptions/domain.exception';

describe('AdminVerificationService', () => {
  let service: AdminVerificationService;
  let mockProfileRepo: Record<string, jest.Mock>;
  let mockDocumentRepo: Record<string, jest.Mock>;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;
  let mockEventEmitter: { emit: jest.Mock };
  let mockAuditService: { log: jest.Mock };
  let mockStorage: { getSignedUrl: jest.Mock };

  const adminUserId = 'admin-1';
  const profileId = 'profile-1';
  const handymanUserId = 'user-1';

  const mockProfile = {
    id: profileId,
    userId: handymanUserId,
    bio: 'Experienced plumber',
    location: 'Lagos',
    verificationStatus: VerificationStatus.DOCUMENTS_SUBMITTED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDocument = {
    id: 'doc-1',
    handymanProfileId: profileId,
    type: 'GOVERNMENT_ID',
    fileKey: 'handyman-documents/profile-1/government_id/doc.pdf',
    fileName: 'id-card.pdf',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser = {
    email: 'handyman@example.com',
    username: 'handyman1',
  };

  beforeEach(async () => {
    mockProfileRepo = {
      findById: jest.fn(),
      findWithDocuments: jest.fn(),
      updateVerificationStatus: jest.fn(),
    };

    mockDocumentRepo = {
      findById: jest.fn(),
      findByProfileId: jest.fn(),
      update: jest.fn(),
    };

    mockPrisma = {
      user: { findUniqueOrThrow: jest.fn() },
      handymanProfile: { findMany: jest.fn(), count: jest.fn() },
    };

    mockEventEmitter = { emit: jest.fn() };
    mockAuditService = { log: jest.fn() };
    mockStorage = {
      getSignedUrl: jest.fn(async (key: string) => `https://files.test/${key}?signed=1`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminVerificationService,
        { provide: HANDYMAN_PROFILE_REPOSITORY, useValue: mockProfileRepo },
        { provide: HANDYMAN_DOCUMENT_REPOSITORY, useValue: mockDocumentRepo },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: AuditService, useValue: mockAuditService },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get<AdminVerificationService>(AdminVerificationService);
  });

  describe('getHandymanForReview', () => {
    it('returns the profile with each document mapped to a signed URL, and audits the access', async () => {
      const profileWithDocs = { ...mockProfile, documents: [mockDocument] };
      mockProfileRepo.findWithDocuments.mockResolvedValue(profileWithDocs);

      const result = await service.getHandymanForReview(profileId, adminUserId);

      expect(mockProfileRepo.findWithDocuments).toHaveBeenCalledWith(profileId);
      // Bug #17: the raw key never leaves the service, a fresh signed URL does.
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]).not.toHaveProperty('fileKey');
      expect(result.documents[0].fileUrl).toBe(
        `https://files.test/${mockDocument.fileKey}?signed=1`,
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: adminUserId,
          action: 'DOCUMENT_ACCESS',
          entity: 'HandymanDocument',
          entityId: mockDocument.id,
        }),
      );
    });

    it('still returns the signed document when the audit insert fails — a read must not 500 on a logging failure', async () => {
      const profileWithDocs = { ...mockProfile, documents: [mockDocument] };
      mockProfileRepo.findWithDocuments.mockResolvedValue(profileWithDocs);
      mockAuditService.log.mockRejectedValueOnce(new Error('db unavailable'));

      const result = await service.getHandymanForReview(profileId, adminUserId);

      expect(result.documents[0].fileUrl).toBe(
        `https://files.test/${mockDocument.fileKey}?signed=1`,
      );
    });

    it('should throw ResourceNotFoundException when not found', async () => {
      mockProfileRepo.findWithDocuments.mockResolvedValue(null);

      await expect(service.getHandymanForReview('nonexistent', adminUserId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('approveHandyman', () => {
    it('should update to VERIFIED and emit event', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      mockProfileRepo.findById.mockResolvedValue(mockProfile);
      mockProfileRepo.updateVerificationStatus.mockResolvedValue(verifiedProfile);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      const result = await service.approveHandyman(profileId, adminUserId);

      expect(result).toEqual(verifiedProfile);
      expect(mockProfileRepo.updateVerificationStatus).toHaveBeenCalledWith(
        profileId,
        VerificationStatus.VERIFIED,
        adminUserId,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.HANDYMAN_VERIFIED,
        expect.objectContaining({
          userId: handymanUserId,
          handymanProfileId: profileId,
          email: mockUser.email,
          username: mockUser.username,
        }),
      );
    });

    it('should throw ResourceNotFoundException when profile not found', async () => {
      mockProfileRepo.findById.mockResolvedValue(null);

      await expect(service.approveHandyman('nonexistent', adminUserId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw InvalidVerificationTransitionException on invalid status', async () => {
      const unverifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.UNVERIFIED,
      };
      mockProfileRepo.findById.mockResolvedValue(unverifiedProfile);

      await expect(service.approveHandyman(profileId, adminUserId)).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });

    it('should throw when profile is already VERIFIED', async () => {
      const verifiedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.VERIFIED,
      };
      mockProfileRepo.findById.mockResolvedValue(verifiedProfile);

      await expect(service.approveHandyman(profileId, adminUserId)).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
    });
  });

  describe('rejectHandyman', () => {
    it('should update to REJECTED with reason and emit event', async () => {
      const rejectedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.REJECTED,
      };
      const dto = { reason: 'Documents are unclear' };

      mockProfileRepo.findById.mockResolvedValue(mockProfile);
      mockProfileRepo.updateVerificationStatus.mockResolvedValue(rejectedProfile);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      const result = await service.rejectHandyman(profileId, adminUserId, dto);

      expect(result).toEqual(rejectedProfile);
      expect(mockProfileRepo.updateVerificationStatus).toHaveBeenCalledWith(
        profileId,
        VerificationStatus.REJECTED,
        adminUserId,
        dto.reason,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EVENTS.HANDYMAN_REJECTED,
        expect.objectContaining({
          userId: handymanUserId,
          handymanProfileId: profileId,
          email: mockUser.email,
          username: mockUser.username,
          reason: dto.reason,
        }),
      );
    });

    it('should throw ResourceNotFoundException when profile not found', async () => {
      mockProfileRepo.findById.mockResolvedValue(null);

      await expect(
        service.rejectHandyman('nonexistent', adminUserId, { reason: 'test' }),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw InvalidVerificationTransitionException on invalid status', async () => {
      const profileComplete = {
        ...mockProfile,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
      };
      mockProfileRepo.findById.mockResolvedValue(profileComplete);

      await expect(
        service.rejectHandyman(profileId, adminUserId, { reason: 'test' }),
      ).rejects.toThrow(InvalidVerificationTransitionException);
    });

    it('should throw when profile is already REJECTED', async () => {
      const rejectedProfile = {
        ...mockProfile,
        verificationStatus: VerificationStatus.REJECTED,
      };
      mockProfileRepo.findById.mockResolvedValue(rejectedProfile);

      await expect(
        service.rejectHandyman(profileId, adminUserId, { reason: 'test' }),
      ).rejects.toThrow(InvalidVerificationTransitionException);
    });
  });

  describe('reviewDocument', () => {
    it('should update document status to APPROVED', async () => {
      const dto = { status: 'APPROVED' as const };
      const updatedDoc = { ...mockDocument, status: 'APPROVED', reviewedAt: new Date() };

      mockDocumentRepo.findById.mockResolvedValue(mockDocument);
      mockDocumentRepo.update.mockResolvedValue(updatedDoc);

      const result = await service.reviewDocument(profileId, 'doc-1', adminUserId, dto);

      expect(result).not.toHaveProperty('fileKey');
      expect(result.fileUrl).toBe(`https://files.test/${updatedDoc.fileKey}?signed=1`);
      expect(mockDocumentRepo.update).toHaveBeenCalledWith('doc-1', {
        status: 'APPROVED',
        rejectionReason: null,
        reviewedBy: { connect: { id: adminUserId } },
        reviewedAt: expect.any(Date),
      });
      // Both the decision and the resulting document access are logged —
      // separately, so a query by action type finds either (finding from
      // review).
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOCUMENT_REVIEW', entityId: 'doc-1' }),
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOCUMENT_ACCESS', entityId: 'doc-1' }),
      );
    });

    it('still returns the signed document when the access-audit insert fails', async () => {
      const dto = { status: 'APPROVED' as const };
      const updatedDoc = { ...mockDocument, status: 'APPROVED', reviewedAt: new Date() };

      mockDocumentRepo.findById.mockResolvedValue(mockDocument);
      mockDocumentRepo.update.mockResolvedValue(updatedDoc);
      mockAuditService.log.mockImplementation((entry: { action: string }) =>
        entry.action === 'DOCUMENT_ACCESS'
          ? Promise.reject(new Error('db unavailable'))
          : Promise.resolve(undefined),
      );

      const result = await service.reviewDocument(profileId, 'doc-1', adminUserId, dto);

      expect(result.fileUrl).toBe(`https://files.test/${updatedDoc.fileKey}?signed=1`);
    });

    it('should update document status to REJECTED with reason', async () => {
      const dto = { status: 'REJECTED' as const, rejectionReason: 'Blurry image' };
      const updatedDoc = {
        ...mockDocument,
        status: 'REJECTED',
        rejectionReason: 'Blurry image',
        reviewedAt: new Date(),
      };

      mockDocumentRepo.findById.mockResolvedValue(mockDocument);
      mockDocumentRepo.update.mockResolvedValue(updatedDoc);

      const result = await service.reviewDocument(profileId, 'doc-1', adminUserId, dto);

      expect(result).not.toHaveProperty('fileKey');
      expect(result.fileUrl).toBe(`https://files.test/${updatedDoc.fileKey}?signed=1`);
      expect(mockDocumentRepo.update).toHaveBeenCalledWith('doc-1', {
        status: 'REJECTED',
        rejectionReason: 'Blurry image',
        reviewedBy: { connect: { id: adminUserId } },
        reviewedAt: expect.any(Date),
      });
    });

    it('should throw ResourceNotFoundException when document not found', async () => {
      mockDocumentRepo.findById.mockResolvedValue(null);

      await expect(
        service.reviewDocument(profileId, 'nonexistent', adminUserId, {
          status: 'APPROVED' as const,
        }),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException when document belongs to different profile', async () => {
      const wrongProfileDoc = { ...mockDocument, handymanProfileId: 'other-profile' };
      mockDocumentRepo.findById.mockResolvedValue(wrongProfileDoc);

      await expect(
        service.reviewDocument(profileId, 'doc-1', adminUserId, { status: 'APPROVED' as const }),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
