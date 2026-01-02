import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistDto, WaitlistResponseDto, WaitlistAdminResponseDto } from './dto';
import {
  Public,
  Roles,
  ApiCreatedSuccessResponse,
  ApiPaginatedResponse,
  ApiErrorResponses,
} from '@/common/decorators';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { IPaginatedResult } from '@/common/interfaces';
import { UserRole } from '@/common/enums';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all waitlist entries (Admin only)' })
  @ApiPaginatedResponse(WaitlistAdminResponseDto)
  @ApiErrorResponses()
  async findAll(
    @Query() paginationDto: PaginationDto,
  ): Promise<IPaginatedResult<WaitlistAdminResponseDto>> {
    return this.waitlistService.findAll(paginationDto);
  }

  @Post()
  @Public()
  @ApiOperation({ summary: 'Join the waitlist' })
  @ApiCreatedSuccessResponse(WaitlistResponseDto)
  @ApiErrorResponses()
  async create(
    @Body() createWaitlistDto: CreateWaitlistDto,
  ): Promise<{ data: WaitlistResponseDto; message: string }> {
    const waitlistEntry = await this.waitlistService.create(createWaitlistDto);
    return {
      data: waitlistEntry,
      message: 'Successfully joined the waitlist',
    };
  }
}
