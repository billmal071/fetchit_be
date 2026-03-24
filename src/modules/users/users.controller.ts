import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateUserDto, UserResponseDto, OnboardUserDto, ONBOARDABLE_ROLES } from './dto';
import { PaginationDto } from '@/common/dto';
import { ParseUUIDPipe } from '@/common/pipes';
import { Roles, CurrentUser, Public } from '@/common/decorators';
import { ApiSuccessResponse, ApiPaginatedResponse, ApiErrorResponses } from '@/common/decorators';
import { UserRole } from '@/common/enums';
import { IPaginatedResult, IRequestUser } from '@/common/interfaces';
import { SUCCESS_MESSAGES } from '@/common/constants';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get all users (Admin only)',
    description: 'List all users with pagination. Admin only.',
  })
  @ApiPaginatedResponse(UserResponseDto)
  @ApiErrorResponses()
  async findAll(
    @Query() paginationDto: PaginationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IPaginatedResult<UserResponseDto>> {
    // Allow clients and proxies to cache this list for 30 seconds
    res.setHeader('Cache-Control', 'private, max-age=30');
    return this.usersService.findAll(paginationDto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Get the authenticated user profile.',
  })
  @ApiSuccessResponse(UserResponseDto)
  @ApiBearerAuth()
  @ApiErrorResponses()
  async getProfile(
    @CurrentUser() user: IRequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: UserResponseDto }> {
    res.setHeader('Cache-Control', 'private, max-age=15');
    const userData = await this.usersService.findOne(user.id);
    return { data: userData };
  }

  @Post('onboard')
  @ApiOperation({
    summary: 'Select user role during onboarding',
    description:
      'Select a role during onboarding. Available roles: CUSTOMER, PERSONAL_SHOPPER, HANDYMAN.',
  })
  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async onboard(
    @CurrentUser() user: IRequestUser,
    @Body() dto: OnboardUserDto,
  ): Promise<{ data: UserResponseDto; message: string }> {
    const updatedUser = await this.usersService.onboard(user.id, dto.role);
    return { data: updatedUser, message: SUCCESS_MESSAGES.USER_ONBOARDED };
  }

  @Get('roles')
  @Public()
  @ApiOperation({
    summary: 'Get available onboardable roles',
    description: 'Get the list of roles available for onboarding. Public endpoint.',
  })
  async getRoles(): Promise<{ data: { roles: readonly string[] } }> {
    return { data: { roles: ONBOARDABLE_ROLES } };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get user by ID (Admin only)',
    description: 'Get a specific user by ID. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the resource' })
  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: UserResponseDto }> {
    res.setHeader('Cache-Control', 'private, max-age=30');
    const user = await this.usersService.findOne(id);
    return { data: user };
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update current user profile',
    description: 'Update the authenticated user profile fields.',
  })
  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async updateProfile(
    @CurrentUser() user: IRequestUser,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<{ data: UserResponseDto; message: string }> {
    const updatedUser = await this.usersService.update(user.id, updateUserDto);
    return { data: updatedUser, message: SUCCESS_MESSAGES.USER_UPDATED };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update user by ID (Admin only)',
    description: 'Update a user by ID. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the resource' })
  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<{ data: UserResponseDto; message: string }> {
    const user = await this.usersService.update(id, updateUserDto);
    return { data: user, message: SUCCESS_MESSAGES.USER_UPDATED };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete user by ID (Admin only)',
    description: 'Soft-delete a user by ID. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the resource' })
  @ApiErrorResponses()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
