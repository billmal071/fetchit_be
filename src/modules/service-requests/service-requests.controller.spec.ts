import { Test, TestingModule } from '@nestjs/testing';
import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';
import { SUCCESS_MESSAGES } from '@common/constants';

const user = { id: 'u1', email: 'a@b.com', role: 'CUSTOMER' } as any;
const mockData = { id: 'sr1' };

describe('ServiceRequestsController', () => {
  let controller: ServiceRequestsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue(mockData),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue(mockData),
      update: jest.fn().mockResolvedValue(mockData),
      cancel: jest.fn().mockResolvedValue(mockData),
      getApplications: jest.fn().mockResolvedValue([]),
      acceptApplication: jest.fn().mockResolvedValue(mockData),
      rejectApplication: jest.fn().mockResolvedValue(mockData),
      confirmCompletion: jest.fn().mockResolvedValue(mockData),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceRequestsController],
      providers: [{ provide: ServiceRequestsService, useValue: service }],
    }).compile();

    controller = module.get(ServiceRequestsController);
  });

  it('create calls service with user id and dto', async () => {
    const dto = { title: 'Fix sink' } as any;
    const result = await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith('u1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.SERVICE_REQUEST_CREATED);
  });

  it('findAll calls service with user id and query', async () => {
    const query = { status: 'OPEN' } as any;
    await controller.findAll(user, query);
    expect(service.findAll).toHaveBeenCalledWith('u1', query);
  });

  it('findOne calls service with id, user id, and role', async () => {
    await controller.findOne(user, 'sr1');
    expect(service.findOne).toHaveBeenCalledWith('sr1', 'u1', 'CUSTOMER');
  });

  it('update calls service with id, user id, and dto', async () => {
    const dto = { title: 'Updated' } as any;
    const result = await controller.update(user, 'sr1', dto);
    expect(service.update).toHaveBeenCalledWith('sr1', 'u1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.SERVICE_REQUEST_UPDATED);
  });

  it('cancel calls service with id and user id', async () => {
    const result = await controller.cancel(user, 'sr1');
    expect(service.cancel).toHaveBeenCalledWith('sr1', 'u1');
    expect(result.message).toBe(SUCCESS_MESSAGES.SERVICE_REQUEST_CANCELLED);
  });

  it('getApplications calls service with id and user id', async () => {
    await controller.getApplications(user, 'sr1');
    expect(service.getApplications).toHaveBeenCalledWith('sr1', 'u1');
  });

  it('acceptApplication calls service with correct args', async () => {
    const result = await controller.acceptApplication(user, 'sr1', 'app1');
    expect(service.acceptApplication).toHaveBeenCalledWith('sr1', 'app1', 'u1');
    expect(result.message).toBe(SUCCESS_MESSAGES.APPLICATION_ACCEPTED);
  });

  it('rejectApplication calls service with correct args', async () => {
    const result = await controller.rejectApplication(user, 'sr1', 'app1');
    expect(service.rejectApplication).toHaveBeenCalledWith('sr1', 'app1', 'u1');
    expect(result.message).toBe(SUCCESS_MESSAGES.APPLICATION_REJECTED);
  });

  it('confirmCompletion calls service with id and user id', async () => {
    const result = await controller.confirmCompletion(user, 'sr1');
    expect(service.confirmCompletion).toHaveBeenCalledWith('sr1', 'u1');
    expect(result.message).toBe('Service request completed successfully');
  });
});
