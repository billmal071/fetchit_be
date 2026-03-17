import { Controller, Get, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { HandymanProfile, HandymanDocument } from '@prisma/client';
import { AdminVerificationService } from './admin-verification.service';
import { RejectHandymanDto, ReviewDocumentDto } from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { IRequestUser } from '@common/interfaces';
import type { IMeta } from '@common/interfaces';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Admin - Handyman Verification')
@Controller('admin/handyman-verification')
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminVerificationController {
  constructor(private readonly adminVerificationService: AdminVerificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get pending handyman verification requests' })
  async getPendingHandymen(
    @Query() pagination: PaginationDto,
  ): Promise<{ data: HandymanProfile[]; meta: IMeta }> {
    return this.adminVerificationService.getPendingHandymen(pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get handyman profile for review with documents' })
  async getHandymanForReview(@Param('id') id: string): Promise<{ data: HandymanProfile }> {
    const data = await this.adminVerificationService.getHandymanForReview(id);
    return { data };
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a handyman verification request' })
  async approveHandyman(
    @Param('id') id: string,
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: HandymanProfile; message: string }> {
    const data = await this.adminVerificationService.approveHandyman(id, user.id);
    return { data, message: SUCCESS_MESSAGES.HANDYMAN_APPROVED };
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a handyman verification request' })
  async rejectHandyman(
    @Param('id') id: string,
    @Body() dto: RejectHandymanDto,
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: HandymanProfile; message: string }> {
    const data = await this.adminVerificationService.rejectHandyman(id, user.id, dto);
    return { data, message: SUCCESS_MESSAGES.HANDYMAN_REJECTED };
  }

  @Patch(':id/documents/:docId/review')
  @ApiOperation({ summary: 'Review a handyman document' })
  async reviewDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: ReviewDocumentDto,
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: HandymanDocument; message: string }> {
    const data = await this.adminVerificationService.reviewDocument(id, docId, user.id, dto);
    return { data, message: 'Document reviewed successfully' };
  }
}
