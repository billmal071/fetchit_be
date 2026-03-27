import { Test, TestingModule } from '@nestjs/testing';
import { ServiceCategoriesController } from './service-categories.controller';
import { ServiceCategoriesService } from './service-categories.service';
import { SUCCESS_MESSAGES } from '@common/constants';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

describe('ServiceCategoriesController', () => {
  let controller: ServiceCategoriesController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Plumbing' }]),
      create: jest.fn().mockResolvedValue({ id: 'c1', name: 'Plumbing' }),
      update: jest.fn().mockResolvedValue({ id: 'c1', name: 'Updated' }),
      deactivate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceCategoriesController],
      providers: [{ provide: ServiceCategoriesService, useValue: service }],
    }).compile();

    controller = module.get(ServiceCategoriesController);
  });

  it('findAll returns categories', async () => {
    const result = await controller.findAll();
    expect(service.findAll).toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
  });

  it('create calls service and returns message', async () => {
    const dto = { name: 'Plumbing' } as CreateCategoryDto;
    const result = await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.CATEGORY_CREATED);
  });

  it('update calls service with id and dto', async () => {
    const dto = { name: 'Updated' } as UpdateCategoryDto;
    const result = await controller.update('c1', dto);
    expect(service.update).toHaveBeenCalledWith('c1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.CATEGORY_UPDATED);
  });

  it('remove calls service.deactivate and returns message', async () => {
    const result = await controller.remove('c1');
    expect(service.deactivate).toHaveBeenCalledWith('c1');
    expect(result.message).toBe(SUCCESS_MESSAGES.CATEGORY_DELETED);
  });
});
