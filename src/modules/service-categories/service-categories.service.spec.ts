import { Test, TestingModule } from '@nestjs/testing';
import { ServiceCategoriesService } from './service-categories.service';
import { SERVICE_CATEGORY_REPOSITORY } from '@/database/repositories';
import {
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
} from '@common/exceptions/domain.exception';

describe('ServiceCategoriesService', () => {
  let service: ServiceCategoriesService;
  let mockRepo: Record<string, jest.Mock>;

  const mockCategory = {
    id: 'cat-1',
    name: 'Plumbing',
    slug: 'plumbing',
    description: 'Plumbing services',
    icon: 'wrench',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRepo = {
      findActive: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceCategoriesService,
        { provide: SERVICE_CATEGORY_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ServiceCategoriesService>(ServiceCategoriesService);
  });

  describe('findAll', () => {
    it('should return all active categories', async () => {
      const categories = [mockCategory];
      mockRepo.findActive.mockResolvedValue(categories);

      const result = await service.findAll();

      expect(result).toEqual(categories);
      expect(mockRepo.findActive).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no active categories', async () => {
      mockRepo.findActive.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return category when found', async () => {
      mockRepo.findById.mockResolvedValue(mockCategory);

      const result = await service.findOne('cat-1');

      expect(result).toEqual(mockCategory);
      expect(mockRepo.findById).toHaveBeenCalledWith('cat-1');
    });

    it('should throw ResourceNotFoundException when not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(ResourceNotFoundException);
    });
  });

  describe('create', () => {
    it('should generate slug and create category', async () => {
      mockRepo.findBySlug.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(mockCategory);

      const dto = { name: 'Plumbing', description: 'Plumbing services', icon: 'wrench' };
      const result = await service.create(dto);

      expect(result).toEqual(mockCategory);
      expect(mockRepo.findBySlug).toHaveBeenCalledWith('plumbing');
      expect(mockRepo.create).toHaveBeenCalledWith({
        name: 'Plumbing',
        slug: 'plumbing',
        description: 'Plumbing services',
        icon: 'wrench',
      });
    });

    it('should generate slug with hyphens for multi-word names', async () => {
      mockRepo.findBySlug.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({
        ...mockCategory,
        name: 'Home Cleaning',
        slug: 'home-cleaning',
      });

      const dto = { name: 'Home Cleaning', description: 'Cleaning services' };
      await service.create(dto);

      expect(mockRepo.findBySlug).toHaveBeenCalledWith('home-cleaning');
    });

    it('should throw ResourceAlreadyExistsException on duplicate slug', async () => {
      mockRepo.findBySlug.mockResolvedValue(mockCategory);

      const dto = { name: 'Plumbing', description: 'Another plumbing' };

      await expect(service.create(dto)).rejects.toThrow(ResourceAlreadyExistsException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update category fields', async () => {
      const updated = { ...mockCategory, description: 'Updated description' };
      mockRepo.findById.mockResolvedValue(mockCategory);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.update('cat-1', { description: 'Updated description' });

      expect(result).toEqual(updated);
      expect(mockRepo.update).toHaveBeenCalledWith('cat-1', { description: 'Updated description' });
    });

    it('should re-slugify when name changes', async () => {
      const updated = { ...mockCategory, name: 'Electrical Work', slug: 'electrical-work' };
      mockRepo.findById.mockResolvedValue(mockCategory);
      mockRepo.findBySlug.mockResolvedValue(null);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.update('cat-1', { name: 'Electrical Work' });

      expect(result).toEqual(updated);
      expect(mockRepo.findBySlug).toHaveBeenCalledWith('electrical-work');
      expect(mockRepo.update).toHaveBeenCalledWith('cat-1', {
        name: 'Electrical Work',
        slug: 'electrical-work',
      });
    });

    it('should throw ResourceAlreadyExistsException when new slug conflicts with another category', async () => {
      mockRepo.findById.mockResolvedValue(mockCategory);
      mockRepo.findBySlug.mockResolvedValue({ ...mockCategory, id: 'cat-other' });

      await expect(service.update('cat-1', { name: 'Plumbing' })).rejects.toThrow(
        ResourceAlreadyExistsException,
      );
    });

    it('should allow update when slug conflicts with same category', async () => {
      mockRepo.findById.mockResolvedValue(mockCategory);
      mockRepo.findBySlug.mockResolvedValue(mockCategory); // same id
      mockRepo.update.mockResolvedValue(mockCategory);

      const result = await service.update('cat-1', { name: 'Plumbing' });

      expect(result).toEqual(mockCategory);
    });

    it('should throw ResourceNotFoundException when category not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.update('nonexistent', { description: 'test' })).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      const deactivated = { ...mockCategory, isActive: false };
      mockRepo.findById.mockResolvedValue(mockCategory);
      mockRepo.update.mockResolvedValue(deactivated);

      const result = await service.deactivate('cat-1');

      expect(result).toEqual(deactivated);
      expect(mockRepo.update).toHaveBeenCalledWith('cat-1', { isActive: false });
    });

    it('should throw ResourceNotFoundException when category not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.deactivate('nonexistent')).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
