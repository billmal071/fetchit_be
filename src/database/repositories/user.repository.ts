import { Injectable } from '@nestjs/common';
import { User, Prisma, UserStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IUserRepository } from './interfaces';

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { username, deletedAt: null },
    });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { googleId, deletedAt: null },
    });
  }

  async findAll(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async findAllWithDeleted(options?: {
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<User[]> {
    return this.prisma.user.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy,
    });
  }

  async count(where?: Partial<User>): Promise<number> {
    return this.prisma.user.count({
      where: { ...where, deletedAt: null },
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async updateRefreshToken(id: string, refreshToken: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { refreshToken },
    });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async updateEmailVerified(id: string, verified: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        emailVerified: verified,
        status: verified ? UserStatus.ACTIVE : UserStatus.PENDING,
      },
    });
  }

  async updateRole(id: string, role: UserRole): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { role, onboardedAt: new Date() },
    });
  }

  async emailExists(email: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    return !!user;
  }

  async usernameExists(username: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    return !!user;
  }
}
