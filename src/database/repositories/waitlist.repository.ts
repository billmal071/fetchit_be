import { Injectable } from '@nestjs/common';
import { Waitlist, Prisma, WaitlistRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IWaitlistRepository } from './interfaces';

@Injectable()
export class WaitlistRepository implements IWaitlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.WaitlistCreateInput): Promise<Waitlist> {
    return this.prisma.waitlist.create({ data });
  }

  async findById(id: string): Promise<Waitlist | null> {
    return this.prisma.waitlist.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<Waitlist | null> {
    return this.prisma.waitlist.findUnique({
      where: { email },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<Waitlist[]> {
    return this.prisma.waitlist.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async findByRole(
    role: WaitlistRole,
    options?: {
      skip?: number;
      take?: number;
      orderBy?: Record<string, 'asc' | 'desc'>;
    },
  ): Promise<Waitlist[]> {
    return this.prisma.waitlist.findMany({
      where: { role },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Partial<Waitlist>): Promise<number> {
    return this.prisma.waitlist.count({
      where,
    });
  }

  async countByRole(role: WaitlistRole): Promise<number> {
    return this.prisma.waitlist.count({
      where: { role },
    });
  }

  async update(id: string, data: Prisma.WaitlistUpdateInput): Promise<Waitlist> {
    return this.prisma.waitlist.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.waitlist.delete({ where: { id } });
  }

  async emailExists(email: string): Promise<boolean> {
    const entry = await this.prisma.waitlist.findUnique({
      where: { email },
      select: { id: true },
    });
    return !!entry;
  }
}
