import { Injectable } from '@nestjs/common';
import { HandymanDocument, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IHandymanDocumentRepository } from './interfaces';

@Injectable()
export class HandymanDocumentRepository implements IHandymanDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.HandymanDocumentCreateInput): Promise<HandymanDocument> {
    return this.prisma.handymanDocument.create({ data });
  }

  async findById(id: string): Promise<HandymanDocument | null> {
    return this.prisma.handymanDocument.findUnique({
      where: { id },
    });
  }

  async findByProfileId(handymanProfileId: string): Promise<HandymanDocument[]> {
    return this.prisma.handymanDocument.findMany({
      where: { handymanProfileId },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<HandymanDocument[]> {
    return this.prisma.handymanDocument.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Prisma.HandymanDocumentWhereInput): Promise<number> {
    return this.prisma.handymanDocument.count({ where });
  }

  async update(id: string, data: Prisma.HandymanDocumentUpdateInput): Promise<HandymanDocument> {
    return this.prisma.handymanDocument.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.handymanDocument.delete({ where: { id } });
  }

  async deleteByIdAndProfileId(id: string, handymanProfileId: string): Promise<void> {
    await this.prisma.handymanDocument.deleteMany({
      where: { id, handymanProfileId },
    });
  }
}
