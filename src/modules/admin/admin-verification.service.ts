import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerificationStatus } from '@prisma/client';
import type { HandymanProfile, HandymanDocument } from '@prisma/client';
import {
  HANDYMAN_PROFILE_REPOSITORY,
  IHandymanProfileRepository,
  HANDYMAN_DOCUMENT_REPOSITORY,
  IHandymanDocumentRepository,
} from '@/database/repositories';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@common/services/audit.service';
import { PaginationDto } from '@common/dto/pagination.dto';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { EVENTS, AUDIT_ACTIONS, CACHE_TTL } from '@common/constants';
import { IDocumentWithSignedUrl } from '@common/interfaces';
import { StorageService } from '@/storage';
import {
  ResourceNotFoundException,
  InvalidVerificationTransitionException,
} from '@common/exceptions/domain.exception';
import { HandymanVerifiedEvent, HandymanRejectedEvent } from '@common/events';
import { IPaginatedResult } from '@common/interfaces';
import { RejectHandymanDto, ReviewDocumentDto } from './dto';

@Injectable()
export class AdminVerificationService {
  private readonly logger = new Logger(AdminVerificationService.name);

  constructor(
    @Inject(HANDYMAN_PROFILE_REPOSITORY)
    private readonly profileRepo: IHandymanProfileRepository,
    @Inject(HANDYMAN_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IHandymanDocumentRepository,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
    private readonly storage: StorageService,
  ) {}

  async getPendingHandymen(pagination: PaginationDto): Promise<IPaginatedResult<HandymanProfile>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;
    const skip = pagination.skip;

    const [profiles, total] = await Promise.all([
      this.prisma.handymanProfile.findMany({
        where: { verificationStatus: VerificationStatus.DOCUMENTS_SUBMITTED },
        include: {
          user: {
            select: { id: true, username: true, email: true, avatar: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.handymanProfile.count({
        where: { verificationStatus: VerificationStatus.DOCUMENTS_SUBMITTED },
      }),
    ]);

    return {
      data: profiles,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async getHandymanForReview(
    profileId: string,
    adminUserId: string,
  ): Promise<HandymanProfile & { documents: IDocumentWithSignedUrl[] }> {
    const profile = await this.profileRepo.findWithDocuments(profileId);

    if (!profile) {
      throw new ResourceNotFoundException('HandymanProfile', profileId);
    }

    // `findWithDocuments` includes `documents`, which the static
    // `HandymanProfile` type doesn't declare — cast once at this boundary
    // rather than widening the repository interface's return type.
    const { documents, ...rest } = profile as HandymanProfile & { documents: HandymanDocument[] };

    const signedDocuments = await Promise.all(
      documents.map(async ({ fileKey, ...doc }) => {
        const fileUrl = await this.storage.getSignedUrl(fileKey, CACHE_TTL.FIVE_MINUTES);

        // Bug #17 requires logging every access to an identity document. This
        // is specifically the sensitive case: an admin viewing another user's
        // government ID / selfie / address proof. Best-effort: this is a read
        // path, so a failed audit insert must not turn a successful review
        // load into a 500.
        await this.logDocumentAccess(adminUserId, doc.id);

        return { ...doc, fileUrl };
      }),
    );

    return { ...rest, documents: signedDocuments };
  }

  async approveHandyman(profileId: string, adminUserId: string): Promise<HandymanProfile> {
    const profile = await this.profileRepo.findById(profileId);

    if (!profile) {
      throw new ResourceNotFoundException('HandymanProfile', profileId);
    }

    if (profile.verificationStatus !== VerificationStatus.DOCUMENTS_SUBMITTED) {
      throw new InvalidVerificationTransitionException(
        profile.verificationStatus,
        VerificationStatus.VERIFIED,
      );
    }

    const updated = await this.profileRepo.updateVerificationStatus(
      profileId,
      VerificationStatus.VERIFIED,
      adminUserId,
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: profile.userId },
      select: { email: true, username: true },
    });

    this.eventEmitter.emit(
      EVENTS.HANDYMAN_VERIFIED,
      new HandymanVerifiedEvent(profile.userId, profileId, user.email, user.username),
    );

    await this.auditService.log({
      userId: adminUserId,
      action: AUDIT_ACTIONS.HANDYMAN_APPROVE,
      entity: 'HandymanProfile',
      entityId: profileId,
    });

    return updated;
  }

  async rejectHandyman(
    profileId: string,
    adminUserId: string,
    dto: RejectHandymanDto,
  ): Promise<HandymanProfile> {
    const profile = await this.profileRepo.findById(profileId);

    if (!profile) {
      throw new ResourceNotFoundException('HandymanProfile', profileId);
    }

    if (profile.verificationStatus !== VerificationStatus.DOCUMENTS_SUBMITTED) {
      throw new InvalidVerificationTransitionException(
        profile.verificationStatus,
        VerificationStatus.REJECTED,
      );
    }

    const updated = await this.profileRepo.updateVerificationStatus(
      profileId,
      VerificationStatus.REJECTED,
      adminUserId,
      dto.reason,
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: profile.userId },
      select: { email: true, username: true },
    });

    this.eventEmitter.emit(
      EVENTS.HANDYMAN_REJECTED,
      new HandymanRejectedEvent(profile.userId, profileId, user.email, user.username, dto.reason),
    );

    await this.auditService.log({
      userId: adminUserId,
      action: AUDIT_ACTIONS.HANDYMAN_REJECT,
      entity: 'HandymanProfile',
      entityId: profileId,
      details: { reason: dto.reason },
    });

    return updated;
  }

  async reviewDocument(
    profileId: string,
    docId: string,
    adminUserId: string,
    dto: ReviewDocumentDto,
  ): Promise<IDocumentWithSignedUrl> {
    const document = await this.documentRepo.findById(docId);

    if (!document || document.handymanProfileId !== profileId) {
      throw new ResourceNotFoundException('HandymanDocument', docId);
    }

    const updated = await this.documentRepo.update(docId, {
      status: dto.status,
      rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason : null,
      reviewedBy: { connect: { id: adminUserId } },
      reviewedAt: new Date(),
    });

    await this.auditService.log({
      userId: adminUserId,
      action: AUDIT_ACTIONS.DOCUMENT_REVIEW,
      entity: 'HandymanDocument',
      entityId: docId,
      details: { status: dto.status },
    });

    // Also a DOCUMENT_ACCESS entry, distinct from DOCUMENT_REVIEW above: an
    // auditor filtering "every time a signed URL was issued for this
    // document" by action type would otherwise miss this one. Best-effort,
    // same reasoning as logDocumentAccess below.
    await this.logDocumentAccess(adminUserId, docId);

    const { fileKey, ...rest } = updated;
    const fileUrl = await this.storage.getSignedUrl(fileKey, CACHE_TTL.FIVE_MINUTES);

    return { ...rest, fileUrl };
  }

  private async logDocumentAccess(adminUserId: string, documentId: string): Promise<void> {
    try {
      await this.auditService.log({
        userId: adminUserId,
        action: AUDIT_ACTIONS.DOCUMENT_ACCESS,
        entity: 'HandymanDocument',
        entityId: documentId,
      });
    } catch (error) {
      this.logger.warn(`Failed to record DOCUMENT_ACCESS for ${documentId}: ${error}`);
    }
  }
}
