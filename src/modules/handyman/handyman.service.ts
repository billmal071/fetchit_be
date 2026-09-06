import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentType, ServiceRequestStatus, VerificationStatus } from '@prisma/client';
import type {
  HandymanProfile,
  HandymanDocument,
  ServiceRequest,
  ServiceRequestApplication,
} from '@prisma/client';
import {
  HANDYMAN_PROFILE_REPOSITORY,
  HANDYMAN_DOCUMENT_REPOSITORY,
  SERVICE_REQUEST_REPOSITORY,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
  IHandymanProfileRepository,
  IHandymanDocumentRepository,
  IServiceRequestRepository,
  IServiceRequestApplicationRepository,
} from '@/database/repositories';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS } from '@common/constants';
import { IPaginatedResult, IUploadedFile } from '@common/interfaces';
import { ALLOWED_UPLOAD_MIME_TYPES, sanitizeFileName, sniffFileType } from '@common/utils';
import { StorageService } from '@/storage';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { PaginationDto } from '@common/dto/pagination.dto';
import {
  HandymanProfileNotFoundException,
  HandymanNotVerifiedException,
  InvalidVerificationTransitionException,
  DuplicateApplicationException,
  ServiceRequestNotOpenException,
  ResourceNotFoundException,
} from '@common/exceptions/domain.exception';
import { BadRequestException, ForbiddenException } from '@common/exceptions/base.exception';
import {
  HandymanProfileCompletedEvent,
  HandymanDocumentsSubmittedEvent,
  ServiceRequestCompletedEvent,
} from '@common/events';
import {
  CompleteProfileDto,
  UpdateProfileDto,
  UploadDocumentDto,
  ApplyServiceRequestDto,
  HandymanServiceRequestQueryDto,
} from './dto';

@Injectable()
export class HandymanService {
  constructor(
    @Inject(HANDYMAN_PROFILE_REPOSITORY)
    private readonly profileRepo: IHandymanProfileRepository,
    @Inject(HANDYMAN_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IHandymanDocumentRepository,
    @Inject(SERVICE_REQUEST_REPOSITORY)
    private readonly serviceRequestRepo: IServiceRequestRepository,
    @Inject(SERVICE_REQUEST_APPLICATION_REPOSITORY)
    private readonly applicationRepo: IServiceRequestApplicationRepository,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storage: StorageService,
  ) {}

  async getDashboard(userId: string): Promise<{
    profile: HandymanProfile;
    stats: { ongoingCount: number; completedCount: number };
  }> {
    // An onboarded handyman always has a profile: create a default one lazily
    // if the row does not exist yet (it is otherwise created on completion).
    const profile = await this.profileRepo.ensureByUserId(userId);

    const [ongoingCount, completedCount] = await Promise.all([
      this.serviceRequestRepo
        .countByHandymanAndStatus(profile.id, ServiceRequestStatus.ASSIGNED)
        .then(async (assigned) => {
          const inProgress = await this.serviceRequestRepo.countByHandymanAndStatus(
            profile.id,
            ServiceRequestStatus.IN_PROGRESS,
          );
          return assigned + inProgress;
        }),
      this.serviceRequestRepo.countByHandymanAndStatus(profile.id, ServiceRequestStatus.COMPLETED),
    ]);

    return {
      profile,
      stats: {
        ongoingCount,
        completedCount,
      },
    };
  }

  async getProfile(userId: string): Promise<HandymanProfile> {
    // An onboarded handyman may not have a profile row yet (it is created on
    // completion). Return a default UNVERIFIED profile in that case so an
    // authenticated handyman never gets a 404 here.
    return this.profileRepo.ensureByUserIdWithDetails(userId);
  }

  async completeProfile(userId: string, dto: CompleteProfileDto): Promise<HandymanProfile> {
    const existing = await this.profileRepo.findByUserId(userId);

    if (existing && existing.verificationStatus !== VerificationStatus.UNVERIFIED) {
      throw new InvalidVerificationTransitionException(
        existing.verificationStatus,
        VerificationStatus.PROFILE_COMPLETE,
      );
    }

    // Fetch user email for event — direct Prisma needed for nested category writes
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    let profile: HandymanProfile;

    if (existing) {
      profile = await this.prisma.handymanProfile.update({
        where: { id: existing.id },
        data: {
          bio: dto.bio,
          location: dto.location,
          latitude: dto.latitude,
          longitude: dto.longitude,
          hourlyRate: dto.hourlyRate,
          yearsOfExperience: dto.yearsOfExperience,
          verificationStatus: VerificationStatus.PROFILE_COMPLETE,
          categories: {
            deleteMany: {},
            create: dto.categoryIds.map((id) => ({
              category: { connect: { id } },
            })),
          },
        },
        include: {
          categories: { include: { category: true } },
        },
      });
    } else {
      profile = await this.profileRepo.create({
        user: { connect: { id: userId } },
        bio: dto.bio,
        location: dto.location,
        latitude: dto.latitude,
        longitude: dto.longitude,
        hourlyRate: dto.hourlyRate,
        yearsOfExperience: dto.yearsOfExperience,
        verificationStatus: VerificationStatus.PROFILE_COMPLETE,
        categories: {
          create: dto.categoryIds.map((id) => ({
            category: { connect: { id } },
          })),
        },
      });
    }

    // Fix #4: Pass actual email instead of empty string
    this.eventEmitter.emit(
      EVENTS.HANDYMAN_PROFILE_COMPLETED,
      new HandymanProfileCompletedEvent(userId, profile.id, user.email),
    );

    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<HandymanProfile> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    const { categoryIds, ...updateData } = dto as CompleteProfileDto & { categoryIds?: string[] };

    // Direct Prisma needed for nested category deleteMany + create
    if (categoryIds?.length) {
      return this.prisma.handymanProfile.update({
        where: { id: profile.id },
        data: {
          ...updateData,
          categories: {
            deleteMany: {},
            create: categoryIds.map((id: string) => ({
              category: { connect: { id } },
            })),
          },
        },
        include: {
          categories: { include: { category: true } },
        },
      });
    }

    return this.profileRepo.update(profile.id, updateData);
  }

  async uploadDocument(userId: string, dto: UploadDocumentDto): Promise<HandymanDocument> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    return this.documentRepo.create({
      handymanProfile: { connect: { id: profile.id } },
      type: dto.type,
      fileUrl: dto.fileUrl,
      fileName: dto.fileName,
    });
  }

  /**
   * Store an uploaded verification document and record it in one call.
   *
   * Nothing the client sent about the file is trusted: the MIME type comes from
   * sniffing the bytes, the storage key is generated here, and the original
   * filename survives only as a sanitized display label.
   */
  async uploadDocumentFile(
    userId: string,
    type: DocumentType,
    file: IUploadedFile | undefined,
  ): Promise<HandymanDocument> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A file is required under the "file" field');
    }

    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    const sniffed = sniffFileType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(
        `Unsupported file type. Allowed types: ${ALLOWED_UPLOAD_MIME_TYPES.join(', ')}`,
      );
    }

    const key = `handyman-documents/${profile.id}/${type.toLowerCase()}/${randomUUID()}.${sniffed.extension}`;

    const stored = await this.storage.upload({
      key,
      body: file.buffer,
      contentType: sniffed.mimeType,
    });

    try {
      return await this.documentRepo.create({
        handymanProfile: { connect: { id: profile.id } },
        type,
        fileUrl: stored.url,
        fileName: sanitizeFileName(file.originalname, `${type.toLowerCase()}.${sniffed.extension}`),
      });
    } catch (error) {
      // Do not leave an orphaned object behind if the row could not be written.
      // StorageService.delete swallows and logs its own failures, so cleanup
      // can never mask the database error we are about to rethrow.
      await this.storage.delete(stored.key);
      throw error;
    }
  }

  async getDocuments(userId: string): Promise<HandymanDocument[]> {
    // Read endpoint: a freshly-onboarded handyman with no profile yet has no
    // documents, so return an empty list rather than 404.
    const profile = await this.profileRepo.ensureByUserId(userId);

    return this.documentRepo.findByProfileId(profile.id);
  }

  // Fix #9: Prevent deletion when documents are under review
  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    if (profile.verificationStatus === VerificationStatus.DOCUMENTS_SUBMITTED) {
      throw new ForbiddenException('Cannot delete documents while they are under review');
    }

    await this.documentRepo.deleteByIdAndProfileId(documentId, profile.id);
  }

  async submitDocuments(userId: string): Promise<HandymanProfile> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    const allowedStatuses: VerificationStatus[] = [
      VerificationStatus.PROFILE_COMPLETE,
      VerificationStatus.REJECTED,
    ];

    if (!allowedStatuses.includes(profile.verificationStatus)) {
      throw new InvalidVerificationTransitionException(
        profile.verificationStatus,
        VerificationStatus.DOCUMENTS_SUBMITTED,
      );
    }

    const documents = await this.documentRepo.findByProfileId(profile.id);
    if (!documents.length) {
      throw new InvalidVerificationTransitionException(
        'NO_DOCUMENTS',
        VerificationStatus.DOCUMENTS_SUBMITTED,
      );
    }

    const updatedProfile = await this.profileRepo.updateVerificationStatus(
      profile.id,
      VerificationStatus.DOCUMENTS_SUBMITTED,
    );

    // Fix #4: Pass actual email instead of empty string
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    this.eventEmitter.emit(
      EVENTS.HANDYMAN_DOCUMENTS_SUBMITTED,
      new HandymanDocumentsSubmittedEvent(userId, profile.id, user.email),
    );

    return updatedProfile;
  }

  // Fix #10: Use repository method with proper status filtering via Prisma
  async getServiceRequests(
    userId: string,
    query: HandymanServiceRequestQueryDto,
  ): Promise<IPaginatedResult<ServiceRequest>> {
    // Read endpoint: no profile yet means no assigned requests — return an
    // empty page rather than 404.
    const profile = await this.profileRepo.ensureByUserId(userId);

    const { page = 1, limit = 10, filter } = query;

    const statusFilter: Record<string, unknown> = {};
    if (filter === 'ongoing') {
      statusFilter.status = {
        in: [ServiceRequestStatus.ASSIGNED, ServiceRequestStatus.IN_PROGRESS],
      };
    } else if (filter === 'completed') {
      statusFilter.status = ServiceRequestStatus.COMPLETED;
    }

    const where = { assignedHandymanId: profile.id, ...statusFilter };

    const [requests, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' as const },
        include: {
          category: true,
          customer: {
            select: { id: true, username: true, email: true, avatar: true, phone: true },
          },
        },
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: createPaginationMeta(page, limit, total),
    } as IPaginatedResult<(typeof requests)[0]>;
  }

  async browseOpenRequests(
    userId: string,
    pagination: PaginationDto,
  ): Promise<IPaginatedResult<ServiceRequest>> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    if (profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new HandymanNotVerifiedException();
    }

    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;

    const where = { status: ServiceRequestStatus.OPEN };

    const [requests, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' as const },
        include: {
          category: true,
          customer: {
            select: { id: true, username: true, email: true, avatar: true, phone: true },
          },
          _count: { select: { applications: true } },
        },
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: createPaginationMeta(page, limit, total),
    } as IPaginatedResult<(typeof requests)[0]>;
  }

  async applyToRequest(
    userId: string,
    requestId: string,
    dto: ApplyServiceRequestDto,
  ): Promise<ServiceRequestApplication> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    if (profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new HandymanNotVerifiedException();
    }

    const request = await this.serviceRequestRepo.findById(requestId);
    if (!request) {
      throw new ResourceNotFoundException('ServiceRequest', requestId);
    }

    if (request.status !== ServiceRequestStatus.OPEN) {
      throw new ServiceRequestNotOpenException();
    }

    const existingApplication = await this.applicationRepo.findExisting(requestId, profile.id);
    if (existingApplication) {
      throw new DuplicateApplicationException();
    }

    return this.applicationRepo.create({
      serviceRequest: { connect: { id: requestId } },
      handymanProfile: { connect: { id: profile.id } },
      coverMessage: dto.coverMessage,
      proposedRate: dto.proposedRate,
    });
  }

  async getApplications(userId: string): Promise<ServiceRequestApplication[]> {
    // Read endpoint: no profile yet means no applications — return an empty
    // list rather than 404.
    const profile = await this.profileRepo.ensureByUserId(userId);

    return this.applicationRepo.findByHandymanProfileId(profile.id);
  }

  async startRequest(userId: string, requestId: string): Promise<ServiceRequest> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    const request = await this.serviceRequestRepo.findById(requestId);
    if (!request) {
      throw new ResourceNotFoundException('ServiceRequest', requestId);
    }

    if (request.assignedHandymanId !== profile.id) {
      throw new ResourceNotFoundException('ServiceRequest', requestId);
    }

    if (request.status !== ServiceRequestStatus.ASSIGNED) {
      throw new InvalidVerificationTransitionException(
        request.status,
        ServiceRequestStatus.IN_PROGRESS,
      );
    }

    return this.serviceRequestRepo.update(requestId, {
      status: ServiceRequestStatus.IN_PROGRESS,
    });
  }

  // Fix #11: Emit SERVICE_REQUEST_COMPLETED event when handyman marks complete
  async completeRequest(userId: string, requestId: string): Promise<ServiceRequest> {
    const profile = await this.profileRepo.findByUserId(userId);
    if (!profile) {
      throw new HandymanProfileNotFoundException();
    }

    const request = await this.serviceRequestRepo.findById(requestId);
    if (!request) {
      throw new ResourceNotFoundException('ServiceRequest', requestId);
    }

    if (request.assignedHandymanId !== profile.id) {
      throw new ResourceNotFoundException('ServiceRequest', requestId);
    }

    if (request.status !== ServiceRequestStatus.IN_PROGRESS) {
      throw new InvalidVerificationTransitionException(
        request.status,
        ServiceRequestStatus.COMPLETED,
      );
    }

    const updatedRequest = await this.serviceRequestRepo.update(requestId, {
      status: ServiceRequestStatus.COMPLETED,
      completedAt: new Date(),
    });

    this.eventEmitter.emit(
      EVENTS.SERVICE_REQUEST_COMPLETED,
      new ServiceRequestCompletedEvent(requestId, profile.id, request.customerId),
    );

    return updatedRequest;
  }
}
