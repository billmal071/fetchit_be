import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type {
  HandymanProfile,
  HandymanDocument,
  ServiceRequest,
  ServiceRequestApplication,
} from '@prisma/client';
import { HandymanService } from './handyman.service';
import {
  CompleteProfileDto,
  UpdateProfileDto,
  UploadDocumentDto,
  ApplyServiceRequestDto,
  HandymanServiceRequestQueryDto,
} from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IRequestUser } from '@common/interfaces';
import type { IPaginatedResult } from '@common/interfaces';
import { PaginationDto } from '@common/dto/pagination.dto';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Handyman')
@Controller('handyman')
@Roles(UserRole.HANDYMAN)
@ApiBearerAuth()
export class HandymanController {
  constructor(private readonly handymanService: HandymanService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get handyman dashboard with stats' })
  async getDashboard(@CurrentUser() user: IRequestUser): Promise<{
    data: { profile: HandymanProfile; stats: { ongoingCount: number; completedCount: number } };
  }> {
    const data = await this.handymanService.getDashboard(user.id);
    return { data };
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get handyman profile' })
  async getProfile(@CurrentUser() user: IRequestUser): Promise<{ data: HandymanProfile }> {
    const data = await this.handymanService.getProfile(user.id);
    return { data };
  }

  @Post('profile/complete')
  @ApiOperation({
    summary: 'Complete handyman profile',
    description: 'Step 1 of verification: fill in bio, location, hourly rate, and select service categories. Transitions status to PROFILE_COMPLETE.',
  })
  async completeProfile(
    @CurrentUser() user: IRequestUser,
    @Body() dto: CompleteProfileDto,
  ): Promise<{ data: HandymanProfile; message: string }> {
    const data = await this.handymanService.completeProfile(user.id, dto);
    return { data, message: SUCCESS_MESSAGES.PROFILE_COMPLETED };
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update handyman profile' })
  async updateProfile(
    @CurrentUser() user: IRequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ data: HandymanProfile; message: string }> {
    const data = await this.handymanService.updateProfile(user.id, dto);
    return { data, message: SUCCESS_MESSAGES.PROFILE_UPDATED };
  }

  @Post('documents')
  @ApiOperation({ summary: 'Upload a verification document' })
  async uploadDocument(
    @CurrentUser() user: IRequestUser,
    @Body() dto: UploadDocumentDto,
  ): Promise<{ data: HandymanDocument; message: string }> {
    const data = await this.handymanService.uploadDocument(user.id, dto);
    return { data, message: SUCCESS_MESSAGES.DOCUMENT_UPLOADED };
  }

  @Get('documents')
  @ApiOperation({ summary: 'Get all uploaded documents' })
  async getDocuments(@CurrentUser() user: IRequestUser): Promise<{ data: HandymanDocument[] }> {
    const data = await this.handymanService.getDocuments(user.id);
    return { data };
  }

  @Delete('documents/:id')
  @ApiOperation({ summary: 'Delete a document' })
  async deleteDocument(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    await this.handymanService.deleteDocument(user.id, id);
    return { message: SUCCESS_MESSAGES.DOCUMENT_DELETED };
  }

  @Post('documents/submit')
  @ApiOperation({
    summary: 'Submit documents for verification review',
    description: 'Step 3 of verification: submit uploaded documents for admin review. Requires at least one document uploaded. Transitions status from PROFILE_COMPLETE or REJECTED to DOCUMENTS_SUBMITTED. No request body needed.',
  })
  async submitDocuments(
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: HandymanProfile; message: string }> {
    const data = await this.handymanService.submitDocuments(user.id);
    return { data, message: SUCCESS_MESSAGES.DOCUMENTS_SUBMITTED };
  }

  @Get('service-requests')
  @ApiOperation({ summary: 'Get assigned service requests' })
  async getServiceRequests(
    @CurrentUser() user: IRequestUser,
    @Query() query: HandymanServiceRequestQueryDto,
  ): Promise<IPaginatedResult<ServiceRequest>> {
    return this.handymanService.getServiceRequests(user.id, query);
  }

  @Get('service-requests/browse')
  @ApiOperation({ summary: 'Browse open service requests (verified handymen only)' })
  async browseOpenRequests(
    @CurrentUser() user: IRequestUser,
    @Query() pagination: PaginationDto,
  ): Promise<IPaginatedResult<ServiceRequest>> {
    return this.handymanService.browseOpenRequests(user.id, pagination);
  }

  @Post('service-requests/:id/apply')
  @ApiOperation({ summary: 'Apply to a service request' })
  async applyToRequest(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
    @Body() dto: ApplyServiceRequestDto,
  ): Promise<{ data: ServiceRequestApplication; message: string }> {
    const data = await this.handymanService.applyToRequest(user.id, id, dto);
    return { data, message: SUCCESS_MESSAGES.APPLICATION_SUBMITTED };
  }

  @Get('applications')
  @ApiOperation({ summary: 'Get all applications by this handyman' })
  async getApplications(
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: ServiceRequestApplication[] }> {
    const data = await this.handymanService.getApplications(user.id);
    return { data };
  }

  @Patch('service-requests/:id/start')
  @ApiOperation({ summary: 'Start an assigned service request' })
  async startRequest(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.handymanService.startRequest(user.id, id);
    return { data, message: SUCCESS_MESSAGES.SERVICE_REQUEST_UPDATED };
  }

  @Patch('service-requests/:id/complete')
  @ApiOperation({ summary: 'Mark a service request as completed' })
  async completeRequest(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.handymanService.completeRequest(user.id, id);
    return { data, message: SUCCESS_MESSAGES.SERVICE_REQUEST_UPDATED };
  }
}
