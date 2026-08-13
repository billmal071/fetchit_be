import { Injectable } from '@nestjs/common';
import { HandymanProfile, Prisma, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IHandymanProfileRepository } from './interfaces';

@Injectable()
export class HandymanProfileRepository implements IHandymanProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Shared "with details" shape so findByUserIdWithDetails and
  // ensureByUserIdWithDetails always return the same relations.
  private static readonly detailsInclude = {
    documents: true,
    categories: {
      include: { category: true },
    },
    user: {
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        phone: true,
      },
    },
  } satisfies Prisma.HandymanProfileInclude;

  async create(data: Prisma.HandymanProfileCreateInput): Promise<HandymanProfile> {
    return this.prisma.handymanProfile.create({ data });
  }

  async findById(id: string): Promise<HandymanProfile | null> {
    return this.prisma.handymanProfile.findUnique({
      where: { id },
    });
  }

  async findByUserId(userId: string): Promise<HandymanProfile | null> {
    return this.prisma.handymanProfile.findUnique({
      where: { userId },
    });
  }

  async ensureByUserId(userId: string): Promise<HandymanProfile> {
    return this.getOrCreate(userId);
  }

  async ensureByUserIdWithDetails(userId: string): Promise<HandymanProfile> {
    return this.getOrCreate(userId, HandymanProfileRepository.detailsInclude);
  }

  /**
   * Get-or-create a handyman profile by userId. Race-safe: on the rare
   * concurrent first-time read where two requests both try to create, the
   * loser's P2002 unique-constraint error is swallowed and the row is re-read.
   * A default profile has verificationStatus UNVERIFIED (schema default).
   */
  private async getOrCreate(
    userId: string,
    include?: Prisma.HandymanProfileInclude,
  ): Promise<HandymanProfile> {
    const existing = await this.prisma.handymanProfile.findUnique({ where: { userId }, include });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.handymanProfile.create({ data: { userId }, include });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' // unique constraint (userId) — created concurrently
      ) {
        return this.prisma.handymanProfile.findUniqueOrThrow({ where: { userId }, include });
      }
      throw error;
    }
  }

  async findByUserIdWithDetails(userId: string): Promise<HandymanProfile | null> {
    return this.prisma.handymanProfile.findUnique({
      where: { userId },
      include: HandymanProfileRepository.detailsInclude,
    });
  }

  async findWithDocuments(id: string): Promise<HandymanProfile | null> {
    return this.prisma.handymanProfile.findUnique({
      where: { id },
      include: {
        documents: true,
        categories: {
          include: { category: true },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            avatar: true,
            phone: true,
          },
        },
      },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<HandymanProfile[]> {
    return this.prisma.handymanProfile.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Partial<HandymanProfile>): Promise<number> {
    return this.prisma.handymanProfile.count({
      where: where as Prisma.HandymanProfileWhereInput,
    });
  }

  async update(id: string, data: Prisma.HandymanProfileUpdateInput): Promise<HandymanProfile> {
    return this.prisma.handymanProfile.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.handymanProfile.delete({ where: { id } });
  }

  async updateVerificationStatus(
    id: string,
    status: VerificationStatus,
    reviewedById?: string,
    rejectionReason?: string,
  ): Promise<HandymanProfile> {
    return this.prisma.handymanProfile.update({
      where: { id },
      data: {
        verificationStatus: status,
        reviewedById,
        rejectionReason,
        verifiedAt: status === VerificationStatus.VERIFIED ? new Date() : undefined,
      },
    });
  }
}
