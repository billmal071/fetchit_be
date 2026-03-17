import { Injectable } from '@nestjs/common';
import { ServiceRequestApplication, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IServiceRequestApplicationRepository } from './interfaces';

@Injectable()
export class ServiceRequestApplicationRepository implements IServiceRequestApplicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.ServiceRequestApplicationCreateInput,
  ): Promise<ServiceRequestApplication> {
    return this.prisma.serviceRequestApplication.create({ data });
  }

  async findById(id: string): Promise<ServiceRequestApplication | null> {
    return this.prisma.serviceRequestApplication.findUnique({
      where: { id },
    });
  }

  async findByRequestId(serviceRequestId: string): Promise<ServiceRequestApplication[]> {
    return this.prisma.serviceRequestApplication.findMany({
      where: { serviceRequestId },
    });
  }

  async findByHandymanProfileId(handymanProfileId: string): Promise<ServiceRequestApplication[]> {
    return this.prisma.serviceRequestApplication.findMany({
      where: { handymanProfileId },
    });
  }

  async findExisting(
    serviceRequestId: string,
    handymanProfileId: string,
  ): Promise<ServiceRequestApplication | null> {
    return this.prisma.serviceRequestApplication.findUnique({
      where: {
        serviceRequestId_handymanProfileId: {
          serviceRequestId,
          handymanProfileId,
        },
      },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<ServiceRequestApplication[]> {
    return this.prisma.serviceRequestApplication.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Prisma.ServiceRequestApplicationWhereInput): Promise<number> {
    return this.prisma.serviceRequestApplication.count({ where });
  }

  async update(
    id: string,
    data: Prisma.ServiceRequestApplicationUpdateInput,
  ): Promise<ServiceRequestApplication> {
    return this.prisma.serviceRequestApplication.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.serviceRequestApplication.delete({ where: { id } });
  }
}
