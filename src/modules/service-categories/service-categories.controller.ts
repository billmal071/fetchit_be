import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ServiceCategoriesService } from './service-categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';
import { Public } from '@common/decorators/public.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import type { ServiceCategory } from '@prisma/client';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Service Categories')
@Controller('service-categories')
export class ServiceCategoriesController {
  constructor(private readonly serviceCategoriesService: ServiceCategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Get all active service categories',
    description: 'Returns all active service categories. No authentication required.',
  })
  async findAll(): Promise<{ data: ServiceCategory[] }> {
    const categories = await this.serviceCategoriesService.findAll();
    return { data: categories };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a service category (Admin only)',
    description:
      'Create a new service category. Generates a URL-safe slug from the name. Admin only.',
  })
  async create(
    @Body() dto: CreateCategoryDto,
  ): Promise<{ data: ServiceCategory; message: string }> {
    const category = await this.serviceCategoriesService.create(dto);
    return { data: category, message: SUCCESS_MESSAGES.CATEGORY_CREATED };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a service category (Admin only)',
    description:
      'Update an existing service category. Re-generates slug if name changes. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<{ data: ServiceCategory; message: string }> {
    const category = await this.serviceCategoriesService.update(id, dto);
    return { data: category, message: SUCCESS_MESSAGES.CATEGORY_UPDATED };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Deactivate a service category (Admin only)',
    description: 'Soft-deactivates a service category (sets isActive to false). Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.serviceCategoriesService.deactivate(id);
    return { message: SUCCESS_MESSAGES.CATEGORY_DELETED };
  }
}
