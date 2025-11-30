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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { PaginationDto } from '@/common/dto';
import { ParseUUIDPipe } from '@/common/pipes';
import { Public, Roles, CurrentUser } from '@/common/decorators';
import {
  ApiSuccessResponse,
  ApiCreatedSuccessResponse,
  ApiPaginatedResponse,
  ApiErrorResponses,
} from '@/common/decorators';
import { UserRole } from '@/common/enums';
import { IPaginatedResult, IRequestUser } from '@/common/interfaces';
import { SUCCESS_MESSAGES } from '@/common/constants';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Public()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiCreatedSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async create(@Body() createUserDto: CreateUserDto): Promise<{
    data: UserResponseDto;
    message: string;
  }> {
    const user = await this.usersService.create(createUserDto);
    return { data: user, message: SUCCESS_MESSAGES.USER_CREATED };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all users (Admin only)' })
  @ApiPaginatedResponse(UserResponseDto)
  @ApiErrorResponses()
  async findAll(@Query() paginationDto: PaginationDto): Promise<IPaginatedResult<UserResponseDto>> {
    return this.usersService.findAll(paginationDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async getProfile(@CurrentUser() user: IRequestUser): Promise<{ data: UserResponseDto }> {
    const userData = await this.usersService.findOne(user.id);
    return { data: userData };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user by ID (Admin only)' })
  @ApiSuccessResponse(UserResponseDto)
  @ApiErrorResponses()
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<{ data: UserResponseDto }> {
    const user = await this.usersService.findOne(id);
    return { data: user };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
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
  @ApiOperation({ summary: 'Update user by ID (Admin only)' })
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
  @ApiOperation({ summary: 'Delete user by ID (Admin only)' })
  @ApiErrorResponses()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
