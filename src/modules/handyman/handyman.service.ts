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
import { EVENTS, CACHE_TTL } from '@common/constants';
import { IPaginatedResult, IUploadedFile, IDocumentWithSignedUrl } from '@common/interfaces';
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
  CategoryNotServicedException,
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

  /**
   * Replace a stored document's `fileKey` with a signed URL valid for
   * `CACHE_TTL.FIVE_MINUTES`. See bug #17: the key itself is never sent to a
   * client.
   *
   * No audit log here on purpose: every caller of this helper is the
   * document's own owner reading their own file (getDocuments,
   * uploadDocumentFile, getProfile). The sensitive case bug #17 is actually
   * about — an admin reading someone else's ID — is audited in
   * AdminVerificationService.getHandymanForReview instead. Logging here too
   * would write one row per document on every single list call with no
   * cap on documents-per-profile, and self-access to one's own data isn't
   * the signal AUDIT_ACTIONS.DOCUMENT_ACCESS exists to capture.
   */
  private async toSignedDocument(document: HandymanDocument): Promise<IDocumentWithSignedUrl> {
    const { fileKey, ...rest } = document;
    const fileUrl = await this.storage.getSignedUrl(fileKey, CACHE_TTL.FIVE_MINUTES);

    return { ...rest, fileUrl };
  }

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

  async getProfile(
    userId: string,
  ): Promise<HandymanProfile & { documents: IDocumentWithSignedUrl[] }> {
    // An onboarded handyman may not have a profile row yet (it is created on
    // completion). Return a default UNVERIFIED profile in that case so an
    // authenticated handyman never gets a 404 here.
    const profile = await this.profileRepo.ensureByUserIdWithDetails(userId);

    // `ensureByUserIdWithDetails` includes `documents`, which the static
    // `HandymanProfile` type doesn't declare — same boundary cast as
    // AdminVerificationService.getHandymanForReview. Bug #17: this embedded
    // list was the second place a raw fileKey reached a client, missed in
    // the first pass because getDocuments/uploadDocumentFile were the
    // obvious document endpoints and this one is reached through the
    // profile, not through /handyman/documents.
    const { documents, ...rest } = profile as HandymanProfile & { documents: HandymanDocument[] };
    const signedDocuments = await Promise.all(
      documents.map((document) => this.toSignedDocument(document)),
    );

    return { ...rest, documents: signedDocuments };
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
  ): Promise<IDocumentWithSignedUrl> {
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

    let document: HandymanDocument;
    try {
      document = await this.documentRepo.create({
        handymanProfile: { connect: { id: profile.id } },
        type,
        fileKey: stored.key,
        fileName: sanitizeFileName(file.originalname, `${type.toLowerCase()}.${sniffed.extension}`),
      });
    } catch (error) {
      // Do not leave an orphaned object behind if the row could not be written.
      // StorageService.delete swallows and logs its own failures, so cleanup
      // can never mask the database error we are about to rethrow.
      await this.storage.delete(stored.key);
      throw error;
    }

    return this.toSignedDocument(document);
  }

  async getDocuments(userId: string): Promise<IDocumentWithSignedUrl[]> {
    // Read endpoint: a freshly-onboarded handyman with no profile yet has no
    // documents, so return an empty list rather than 404.
    const profile = await this.profileRepo.ensureByUserId(userId);
    const documents = await this.documentRepo.findByProfileId(profile.id);

    return Promise.all(documents.map((document) => this.toSignedDocument(document)));
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
          // No email/phone here: this feed is visible to every verified
          // handyman before any application exists, so it was leaking every
          // customer's contact details to the whole handyman pool. Phone is
          // revealed only after an application is accepted (see
          // service-requests.service.ts).
          customer: {
            select: { id: true, username: true, avatar: true },
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

    // Bug #8: nothing stopped a handyman applying outside their own
    // categories — a plumber could apply for electrical work.
    const servicesCategory = await this.prisma.handymanProfileCategory.findUnique({
      where: {
        handymanProfileId_categoryId: {
          handymanProfileId: profile.id,
          categoryId: request.categoryId,
        },
      },
    });
    if (!servicesCategory) {
      throw new CategoryNotServicedException();
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
