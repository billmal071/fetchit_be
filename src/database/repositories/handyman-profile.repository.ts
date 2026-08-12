import { Injectable } from '@nestjs/common';
import { HandymanProfile, Prisma, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IHandymanProfileRepository } from './interfaces';

@Injectable()
export class HandymanProfileRepository implements IHandymanProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

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
    // upsert with an empty update makes this a safe get-or-create: if a row
    // already exists it is returned untouched; otherwise a default profile
    // (verificationStatus defaults to UNVERIFIED) is created. The unique
    // constraint on userId makes concurrent first-time reads collapse to one row.
    return this.prisma.handymanProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async findByUserIdWithDetails(userId: string): Promise<HandymanProfile | null> {
    return this.prisma.handymanProfile.findUnique({
      where: { userId },
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
