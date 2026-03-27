import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { IUserRepository, USER_REPOSITORY } from '@/database/repositories';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  EmailNotVerifiedException,
} from '@/common/exceptions';

import * as hashUtil from '@/common/utils/hash.util';

const mockUser = {
  id: 'user-1',
  username: 'johndoe',
  email: 'john@example.com',
  password: 'hashed_password',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  emailVerified: true,
  refreshToken: null,
  avatar: null,
  phone: null,
  lastLoginAt: null,
  provider: 'LOCAL',
  googleId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: jest.Mocked<IUserRepository>;

  beforeEach(async () => {
    userRepository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      findByGoogleId: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      updateRefreshToken: jest.fn(),
      updateLastLogin: jest.fn(),
      updatePassword: jest.fn(),
      updateEmailVerified: jest.fn(),
      updateRole: jest.fn(),
      emailExists: jest.fn(),
      usernameExists: jest.fn(),
    } as unknown as jest.Mocked<IUserRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: USER_REPOSITORY, useValue: userRepository }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    const createUserDto = {
      username: 'johndoe',
      email: 'john@example.com',
      password: 'P@ssword1',
    };

    it('should create a user with hashed password', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.findByUsername.mockResolvedValue(null);
      userRepository.create.mockResolvedValue(mockUser as any);
      jest.spyOn(hashUtil, 'hashPassword').mockResolvedValue('hashed_password');

      const result = await service.create(createUserDto);

      expect(userRepository.findByEmail).toHaveBeenCalledWith(createUserDto.email);
      expect(userRepository.findByUsername).toHaveBeenCalledWith(createUserDto.username);
      expect(hashUtil.hashPassword).toHaveBeenCalledWith(createUserDto.password);
      expect(userRepository.create).toHaveBeenCalledWith({
        ...createUserDto,
        password: 'hashed_password',
      });
      expect(result).toHaveProperty('id', 'user-1');
      expect(result).toHaveProperty('email', 'john@example.com');
    });

    it('should throw ConflictException if email already exists', async () => {
      userRepository.findByEmail.mockResolvedValue(mockUser as any);

      await expect(service.create(createUserDto)).rejects.toThrow(ConflictException);
      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if username already exists', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.findByUsername.mockResolvedValue(mockUser as any);

      await expect(service.create(createUserDto)).rejects.toThrow(ConflictException);
      expect(userRepository.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated results with meta', async () => {
      const users = [mockUser];
      userRepository.findAll.mockResolvedValue(users as any);
      userRepository.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 } as any);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual(
        expect.objectContaining({
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        }),
      );
      expect(userRepository.findAll).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should apply default pagination when no params given', async () => {
      userRepository.findAll.mockResolvedValue([]);
      userRepository.count.mockResolvedValue(0);

      const result = await service.findAll({} as any);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return user DTO when found', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);

      const result = await service.findOne('user-1');

      expect(result).toHaveProperty('id', 'user-1');
      expect(result).toHaveProperty('email', 'john@example.com');
      expect(userRepository.findById).toHaveBeenCalledWith('user-1');
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    const updateDto = { username: 'janedoe' };

    it('should update and return user DTO', async () => {
      const updatedUser = { ...mockUser, username: 'janedoe' };
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.update.mockResolvedValue(updatedUser as any);

      const result = await service.update('user-1', updateDto);

      expect(result).toHaveProperty('username', 'janedoe');
      expect(userRepository.update).toHaveBeenCalledWith('user-1', updateDto);
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.update('nonexistent', updateDto)).rejects.toThrow(NotFoundException);
      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  // ── remove ──────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should soft delete by default', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.softDelete.mockResolvedValue(undefined);

      await service.remove('user-1');

      expect(userRepository.softDelete).toHaveBeenCalledWith('user-1');
      expect(userRepository.delete).not.toHaveBeenCalled();
    });

    it('should hard delete when hard=true', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.delete.mockResolvedValue(undefined);

      await service.remove('user-1', true);

      expect(userRepository.delete).toHaveBeenCalledWith('user-1');
      expect(userRepository.softDelete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── onboard ─────────────────────────────────────────────────────────

  describe('onboard', () => {
    it('should update role and return user DTO', async () => {
      const onboardedUser = { ...mockUser, role: 'HANDYMAN' };
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.updateRole.mockResolvedValue(onboardedUser as any);

      const result = await service.onboard('user-1', 'HANDYMAN' as any);

      expect(result).toHaveProperty('role', 'HANDYMAN');
      expect(userRepository.updateRole).toHaveBeenCalledWith('user-1', 'HANDYMAN');
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.onboard('nonexistent', 'CUSTOMER' as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw EmailNotVerifiedException when email not verified', async () => {
      const unverifiedUser = { ...mockUser, emailVerified: false };
      userRepository.findById.mockResolvedValue(unverifiedUser as any);

      await expect(service.onboard('user-1', 'CUSTOMER' as any)).rejects.toThrow(
        EmailNotVerifiedException,
      );
    });

    it('should throw ForbiddenException when user is ADMIN', async () => {
      const adminUser = { ...mockUser, role: 'ADMIN' };
      userRepository.findById.mockResolvedValue(adminUser as any);

      await expect(service.onboard('user-1', 'CUSTOMER' as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── findByEmail / findById (delegation) ─────────────────────────────

  describe('findByEmail', () => {
    it('should delegate to repository', async () => {
      userRepository.findByEmail.mockResolvedValue(mockUser as any);

      const result = await service.findByEmail('john@example.com');

      expect(result).toEqual(mockUser);
      expect(userRepository.findByEmail).toHaveBeenCalledWith('john@example.com');
    });

    it('should return null when not found', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      const result = await service.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should delegate to repository', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);

      const result = await service.findById('user-1');

      expect(result).toEqual(mockUser);
      expect(userRepository.findById).toHaveBeenCalledWith('user-1');
    });

    it('should return null when not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });
});
