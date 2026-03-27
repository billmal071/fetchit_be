import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SUCCESS_MESSAGES } from '@/common/constants';
import { ONBOARDABLE_ROLES, OnboardUserDto, UpdateUserDto } from './dto';
import { PaginationDto } from '@/common/dto';
import { IRequestUser } from '@/common/interfaces';
import { UserRole } from '@/common/enums';

const mockUser: IRequestUser = { id: 'u1', email: 'a@b.com', role: 'CUSTOMER' };
const mockRes = { setHeader: jest.fn() } as Partial<Response> as Response;

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockResolvedValue(mockUser),
      remove: jest.fn(),
      onboard: jest.fn().mockResolvedValue(mockUser),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get(UsersController);
  });

  it('findAll should call usersService.findAll and set cache header', async () => {
    const pagination = Object.assign(new PaginationDto(), { page: 1, limit: 10 });
    await controller.findAll(pagination, mockRes);
    expect(usersService.findAll).toHaveBeenCalledWith(pagination);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=30');
  });

  it('getProfile should call usersService.findOne with user id', async () => {
    const result = await controller.getProfile(mockUser, mockRes);
    expect(usersService.findOne).toHaveBeenCalledWith('u1');
    expect(result.data).toBeDefined();
  });

  it('onboard should call usersService.onboard', async () => {
    const dto: OnboardUserDto = { role: UserRole.CUSTOMER };
    const result = await controller.onboard(mockUser, dto);
    expect(usersService.onboard).toHaveBeenCalledWith('u1', UserRole.CUSTOMER);
    expect(result.message).toBe(SUCCESS_MESSAGES.USER_ONBOARDED);
  });

  it('getRoles should return ONBOARDABLE_ROLES', async () => {
    const result = await controller.getRoles();
    expect(result.data.roles).toBe(ONBOARDABLE_ROLES);
  });

  it('findOne should call usersService.findOne with param id', async () => {
    const result = await controller.findOne('u2', mockRes);
    expect(usersService.findOne).toHaveBeenCalledWith('u2');
    expect(result.data).toBeDefined();
  });

  it('updateProfile should call usersService.update with user id', async () => {
    const dto = { username: 'new' } as UpdateUserDto;
    const result = await controller.updateProfile(mockUser, dto);
    expect(usersService.update).toHaveBeenCalledWith('u1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.USER_UPDATED);
  });

  it('update should call usersService.update with param id', async () => {
    const dto = { username: 'new' } as UpdateUserDto;
    const result = await controller.update('u2', dto);
    expect(usersService.update).toHaveBeenCalledWith('u2', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.USER_UPDATED);
  });

  it('remove should call usersService.remove', async () => {
    await controller.remove(mockUser, 'u2');
    expect(usersService.remove).toHaveBeenCalledWith('u2');
  });

  it('remove should throw ForbiddenException when deleting own account', async () => {
    await expect(controller.remove(mockUser, 'u1')).rejects.toThrow(ForbiddenException);
    expect(usersService.remove).not.toHaveBeenCalled();
  });
});
