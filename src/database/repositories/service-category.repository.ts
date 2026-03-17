import { Injectable } from '@nestjs/common';
import { ServiceCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IServiceCategoryRepository } from './interfaces';

@Injectable()
export class ServiceCategoryRepository implements IServiceCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ServiceCategoryCreateInput): Promise<ServiceCategory> {
    return this.prisma.serviceCategory.create({ data });
  }

  async findById(id: string): Promise<ServiceCategory | null> {
    return this.prisma.serviceCategory.findUnique({
      where: { id },
    });
  }

  async findActive(): Promise<ServiceCategory[]> {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findBySlug(slug: string): Promise<ServiceCategory | null> {
    return this.prisma.serviceCategory.findUnique({
      where: { slug },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<ServiceCategory[]> {
    return this.prisma.serviceCategory.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Prisma.ServiceCategoryWhereInput): Promise<number> {
    return this.prisma.serviceCategory.count({ where });
  }

  async update(id: string, data: Prisma.ServiceCategoryUpdateInput): Promise<ServiceCategory> {
    return this.prisma.serviceCategory.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.serviceCategory.delete({ where: { id } });
  }
}
