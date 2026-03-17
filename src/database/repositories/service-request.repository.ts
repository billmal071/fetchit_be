import { Injectable } from '@nestjs/common';
import { ServiceRequest, Prisma, ServiceRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IServiceRequestRepository } from './interfaces';

@Injectable()
export class ServiceRequestRepository implements IServiceRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ServiceRequestCreateInput): Promise<ServiceRequest> {
    return this.prisma.serviceRequest.create({ data });
  }

  async findById(id: string): Promise<ServiceRequest | null> {
    return this.prisma.serviceRequest.findUnique({
      where: { id },
    });
  }

  async findByCustomerId(
    customerId: string,
    options?: { skip?: number; take?: number; orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<ServiceRequest[]> {
    return this.prisma.serviceRequest.findMany({
      where: { customerId },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy ?? { createdAt: 'desc' },
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
    });
  }

  async findByHandymanId(
    handymanProfileId: string,
    options?: { skip?: number; take?: number; orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<ServiceRequest[]> {
    return this.prisma.serviceRequest.findMany({
      where: { assignedHandymanId: handymanProfileId },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy ?? { createdAt: 'desc' },
      include: {
        category: true,
        customer: {
          select: { id: true, username: true, email: true, avatar: true, phone: true },
        },
      },
    });
  }

  async findOpenRequests(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<ServiceRequest[]> {
    return this.prisma.serviceRequest.findMany({
      where: { status: ServiceRequestStatus.OPEN },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy ?? { createdAt: 'desc' },
      include: {
        category: true,
        customer: {
          select: { id: true, username: true, email: true, avatar: true, phone: true },
        },
        _count: { select: { applications: true } },
      },
    });
  }

  async countByHandymanAndStatus(
    handymanProfileId: string,
    status: ServiceRequestStatus,
  ): Promise<number> {
    return this.prisma.serviceRequest.count({
      where: {
        assignedHandymanId: handymanProfileId,
        status,
      },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<ServiceRequest[]> {
    return this.prisma.serviceRequest.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Prisma.ServiceRequestWhereInput): Promise<number> {
    return this.prisma.serviceRequest.count({ where });
  }

  async update(id: string, data: Prisma.ServiceRequestUpdateInput): Promise<ServiceRequest> {
    return this.prisma.serviceRequest.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.serviceRequest.delete({ where: { id } });
  }
}
