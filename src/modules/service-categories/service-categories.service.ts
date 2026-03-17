import { Injectable, Inject } from '@nestjs/common';
import type { ServiceCategory } from '@prisma/client';
import { IServiceCategoryRepository, SERVICE_CATEGORY_REPOSITORY } from '@/database/repositories';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';
import {
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
} from '@common/exceptions/domain.exception';

@Injectable()
export class ServiceCategoriesService {
  constructor(
    @Inject(SERVICE_CATEGORY_REPOSITORY)
    private readonly categoryRepository: IServiceCategoryRepository,
  ) {}

  async findAll(): Promise<ServiceCategory[]> {
    return this.categoryRepository.findActive();
  }

  async findOne(id: string): Promise<ServiceCategory> {
    const category = await this.categoryRepository.findById(id);

    if (!category) {
      throw new ResourceNotFoundException('ServiceCategory', id);
    }

    return category;
  }

  async create(dto: CreateCategoryDto): Promise<ServiceCategory> {
    const slug = this.generateSlug(dto.name);

    const existing = await this.categoryRepository.findBySlug(slug);

    if (existing) {
      throw new ResourceAlreadyExistsException('ServiceCategory', 'slug', slug);
    }

    return this.categoryRepository.create({
      name: dto.name,
      slug,
      description: dto.description,
      icon: dto.icon,
    });
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<ServiceCategory> {
    const category = await this.categoryRepository.findById(id);

    if (!category) {
      throw new ResourceNotFoundException('ServiceCategory', id);
    }

    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const slug = this.generateSlug(dto.name);
      const existing = await this.categoryRepository.findBySlug(slug);

      if (existing && existing.id !== id) {
        throw new ResourceAlreadyExistsException('ServiceCategory', 'slug', slug);
      }

      data.name = dto.name;
      data.slug = slug;
    }

    if (dto.description !== undefined) data.description = dto.description;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.categoryRepository.update(id, data);
  }

  async deactivate(id: string): Promise<ServiceCategory> {
    const category = await this.categoryRepository.findById(id);

    if (!category) {
      throw new ResourceNotFoundException('ServiceCategory', id);
    }

    return this.categoryRepository.update(id, { isActive: false });
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
}
