import { Injectable, Logger, Inject } from '@nestjs/common';
import { User, UserStatus, AuthProvider, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { OnboardableRole } from './dto';
import { ConflictException, NotFoundException, ForbiddenException, EmailNotVerifiedException } from '@/common/exceptions';
import { hashPassword } from '@/common/utils';
import { PaginationDto } from '@/common/dto';
import { createPaginationMeta } from '@/common/utils';
import { IPaginatedResult } from '@/common/interfaces';
import { ERROR_MESSAGES } from '@/common/constants';
import { IUserRepository, USER_REPOSITORY } from '@/database/repositories';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const existingEmail = await this.userRepository.findByEmail(createUserDto.email);
    if (existingEmail) {
      throw new ConflictException(ERROR_MESSAGES.USER_EXISTS);
    }

    const existingUsername = await this.userRepository.findByUsername(createUserDto.username);
    if (existingUsername) {
      throw new ConflictException('User with this username already exists');
    }

    const hashedPassword = await hashPassword(createUserDto.password);

    const user = await this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });

    this.logger.log(`User created with id: ${user.id}`);

    return plainToInstance(UserResponseDto, user);
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findByUsername(username);
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.userRepository.findByGoogleId(googleId);
  }

  async createOAuthUser(data: {
    email: string;
    username: string;
    googleId: string;
    avatar?: string;
  }): Promise<UserResponseDto> {
    const user = await this.userRepository.create({
      email: data.email,
      username: data.username,
      googleId: data.googleId,
      avatar: data.avatar,
      provider: AuthProvider.GOOGLE,
      emailVerified: true,
      status: UserStatus.ACTIVE,
    });

    this.logger.log(`OAuth user created with id: ${user.id}`);
    return plainToInstance(UserResponseDto, user);
  }

  async updateEmailVerified(id: string, verified: boolean): Promise<void> {
    await this.userRepository.updateEmailVerified(id, verified);
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await this.userRepository.updatePassword(id, hashedPassword);
  }

  async findAll(paginationDto: PaginationDto): Promise<IPaginatedResult<UserResponseDto>> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = paginationDto;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userRepository.findAll({
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder.toLowerCase() as 'asc' | 'desc' },
      }),
      this.userRepository.count(),
    ]);

    return {
      data: plainToInstance(UserResponseDto, users),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User');
    }

    return plainToInstance(UserResponseDto, user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findByEmail(email);
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User');
    }

    const updatedUser = await this.userRepository.update(id, updateUserDto);

    this.logger.log(`User updated with id: ${id}`);

    return plainToInstance(UserResponseDto, updatedUser);
  }

  async remove(id: string, hard: boolean = false): Promise<void> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User');
    }

    if (hard) {
      return this.userRepository.delete(id);
    }
    await this.userRepository.softDelete(id);

    this.logger.log(`User ${hard ? 'hard' : 'soft'} deleted with id: ${id}`);
  }

  async onboard(userId: string, role: OnboardableRole): Promise<UserResponseDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User');
    }

    if (!user.emailVerified) {
      throw new EmailNotVerifiedException();
    }

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin users cannot change their role');
    }

    const updatedUser = await this.userRepository.updateRole(userId, role);
    this.logger.log(`User ${userId} onboarded as ${role}`);

    return plainToInstance(UserResponseDto, updatedUser);
  }

  async updateRefreshToken(id: string, refreshToken: string | null): Promise<void> {
    await this.userRepository.updateRefreshToken(id, refreshToken);
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.userRepository.updateLastLogin(id);
  }
}
