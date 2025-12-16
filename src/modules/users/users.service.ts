import { Injectable, Logger } from '@nestjs/common';
import { User, UserStatus, AuthProvider } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@/database/prisma.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { ConflictException, NotFoundException } from '@/common/exceptions';
import { hashPassword } from '@/common/utils';
import { PaginationDto } from '@/common/dto';
import { createPaginationMeta } from '@/common/utils';
import { IPaginatedResult } from '@/common/interfaces';
import { ERROR_MESSAGES } from '@/common/constants';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const existingEmail = await this.findByEmail(createUserDto.email);
    if (existingEmail) {
      throw new ConflictException(ERROR_MESSAGES.USER_EXISTS);
    }

    const existingUsername = await this.findByUsername(createUserDto.username);
    if (existingUsername) {
      throw new ConflictException('User with this username already exists');
    }

    const hashedPassword = await hashPassword(createUserDto.password);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
    });

    this.logger.log(`User created with id: ${user.id}`);

    return plainToInstance(UserResponseDto, user);
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

  async createOAuthUser(data: {
    email: string;
    username: string;
    googleId: string;
    avatar?: string;
  }): Promise<UserResponseDto> {
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        googleId: data.googleId,
        avatar: data.avatar,
        provider: AuthProvider.GOOGLE,
        emailVerified: true,
        status: UserStatus.ACTIVE,
      },
    });

    this.logger.log(`OAuth user created with id: ${user.id}`);
    return plainToInstance(UserResponseDto, user);
  }

  async updateEmailVerified(id: string, verified: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { emailVerified: verified, status: verified ? UserStatus.ACTIVE : UserStatus.PENDING },
    });
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async findAll(paginationDto: PaginationDto): Promise<IPaginatedResult<UserResponseDto>> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = paginationDto;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { [sortBy]: sortOrder.toLowerCase() },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);

    return {
      data: plainToInstance(UserResponseDto, users),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('User');
    }

    return plainToInstance(UserResponseDto, user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });

    this.logger.log(`User updated with id: ${id}`);

    return plainToInstance(UserResponseDto, updatedUser);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User');
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`User soft deleted with id: ${id}`);
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
}
