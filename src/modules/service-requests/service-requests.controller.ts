import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { ServiceRequest, ServiceRequestApplication } from '@prisma/client';
import { ServiceRequestsService } from './service-requests.service';
import { CreateServiceRequestDto, UpdateServiceRequestDto, ServiceRequestQueryDto } from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IRequestUser } from '@common/interfaces';
import type { IMeta } from '@common/interfaces';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Service Requests')
@ApiBearerAuth()
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly serviceRequestsService: ServiceRequestsService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Create a new service request' })
  async create(
    @CurrentUser() user: IRequestUser,
    @Body() dto: CreateServiceRequestDto,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.serviceRequestsService.create(user.id, dto);
    return { data, message: SUCCESS_MESSAGES.SERVICE_REQUEST_CREATED };
  }

  @Get()
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Get all service requests for the current customer' })
  async findAll(
    @CurrentUser() user: IRequestUser,
    @Query() query: ServiceRequestQueryDto,
  ): Promise<{ data: unknown[]; meta: IMeta }> {
    const result = await this.serviceRequestsService.findAll(user.id, query);
    return { data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service request by ID' })
  async findOne(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ data: ServiceRequest }> {
    const data = await this.serviceRequestsService.findOne(id, user.id, user.role);
    return { data };
  }

  @Patch(':id')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Update a service request' })
  async update(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceRequestDto,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.serviceRequestsService.update(id, user.id, dto);
    return { data, message: SUCCESS_MESSAGES.SERVICE_REQUEST_UPDATED };
  }

  @Delete(':id')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Cancel a service request' })
  async cancel(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.serviceRequestsService.cancel(id, user.id);
    return { data, message: SUCCESS_MESSAGES.SERVICE_REQUEST_CANCELLED };
  }

  @Get(':id/applications')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Get all applications for a service request' })
  async getApplications(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ data: ServiceRequestApplication[] }> {
    const data = await this.serviceRequestsService.getApplications(id, user.id);
    return { data };
  }

  @Patch(':id/applications/:appId/accept')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Accept an application for a service request' })
  async acceptApplication(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
    @Param('appId') appId: string,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.serviceRequestsService.acceptApplication(id, appId, user.id);
    return { data, message: SUCCESS_MESSAGES.APPLICATION_ACCEPTED };
  }

  @Patch(':id/applications/:appId/reject')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Reject an application for a service request' })
  async rejectApplication(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
    @Param('appId') appId: string,
  ): Promise<{ data: ServiceRequestApplication; message: string }> {
    const data = await this.serviceRequestsService.rejectApplication(id, appId, user.id);
    return { data, message: SUCCESS_MESSAGES.APPLICATION_REJECTED };
  }

  @Patch(':id/complete')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Confirm completion of a service request' })
  async confirmCompletion(
    @CurrentUser() user: IRequestUser,
    @Param('id') id: string,
  ): Promise<{ data: ServiceRequest; message: string }> {
    const data = await this.serviceRequestsService.confirmCompletion(id, user.id);
    return { data, message: 'Service request completed successfully' };
  }
}
