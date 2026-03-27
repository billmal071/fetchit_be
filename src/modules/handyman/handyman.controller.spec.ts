import { Test, TestingModule } from '@nestjs/testing';
import { HandymanController } from './handyman.controller';
import { HandymanService } from './handyman.service';
import { SUCCESS_MESSAGES } from '@common/constants';
import { PaginationDto } from '@common/dto/pagination.dto';

const user = { id: 'u1', email: 'a@b.com', role: 'HANDYMAN' } as any;
const mockData = { id: 'p1' };

describe('HandymanController', () => {
  let controller: HandymanController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getDashboard: jest.fn().mockResolvedValue(mockData),
      getProfile: jest.fn().mockResolvedValue(mockData),
      completeProfile: jest.fn().mockResolvedValue(mockData),
      updateProfile: jest.fn().mockResolvedValue(mockData),
      uploadDocument: jest.fn().mockResolvedValue(mockData),
      getDocuments: jest.fn().mockResolvedValue([mockData]),
      deleteDocument: jest.fn(),
      submitDocuments: jest.fn().mockResolvedValue(mockData),
      getServiceRequests: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      browseOpenRequests: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      applyToRequest: jest.fn().mockResolvedValue(mockData),
      getApplications: jest.fn().mockResolvedValue([mockData]),
      startRequest: jest.fn().mockResolvedValue(mockData),
      completeRequest: jest.fn().mockResolvedValue(mockData),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HandymanController],
      providers: [{ provide: HandymanService, useValue: service }],
    }).compile();

    controller = module.get(HandymanController);
  });

  it('getDashboard calls service with user id', async () => {
    await controller.getDashboard(user);
    expect(service.getDashboard).toHaveBeenCalledWith('u1');
  });

  it('getProfile calls service with user id', async () => {
    await controller.getProfile(user);
    expect(service.getProfile).toHaveBeenCalledWith('u1');
  });

  it('completeProfile calls service and returns message', async () => {
    const dto = { bio: 'hi' } as any;
    const result = await controller.completeProfile(user, dto);
    expect(service.completeProfile).toHaveBeenCalledWith('u1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.PROFILE_COMPLETED);
  });

  it('updateProfile calls service with user id', async () => {
    const dto = { bio: 'new' } as any;
    const result = await controller.updateProfile(user, dto);
    expect(service.updateProfile).toHaveBeenCalledWith('u1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.PROFILE_UPDATED);
  });

  it('uploadDocument calls service', async () => {
    const dto = { type: 'GOVERNMENT_ID', fileUrl: 'url' } as any;
    const result = await controller.uploadDocument(user, dto);
    expect(service.uploadDocument).toHaveBeenCalledWith('u1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.DOCUMENT_UPLOADED);
  });

  it('getDocuments calls service', async () => {
    const result = await controller.getDocuments(user);
    expect(service.getDocuments).toHaveBeenCalledWith('u1');
    expect(result.data).toHaveLength(1);
  });

  it('deleteDocument calls service with user id and doc id', async () => {
    const result = await controller.deleteDocument(user, 'd1');
    expect(service.deleteDocument).toHaveBeenCalledWith('u1', 'd1');
    expect(result.message).toBe(SUCCESS_MESSAGES.DOCUMENT_DELETED);
  });

  it('submitDocuments calls service', async () => {
    const result = await controller.submitDocuments(user);
    expect(service.submitDocuments).toHaveBeenCalledWith('u1');
    expect(result.message).toBe(SUCCESS_MESSAGES.DOCUMENTS_SUBMITTED);
  });

  it('getServiceRequests calls service with query', async () => {
    const query = { status: 'ongoing' } as any;
    await controller.getServiceRequests(user, query);
    expect(service.getServiceRequests).toHaveBeenCalledWith('u1', query);
  });

  it('browseOpenRequests calls service with pagination', async () => {
    const pagination = Object.assign(new PaginationDto(), { page: 1, limit: 10 });
    await controller.browseOpenRequests(user, pagination);
    expect(service.browseOpenRequests).toHaveBeenCalledWith('u1', pagination);
  });

  it('applyToRequest calls service with user id, request id, dto', async () => {
    const dto = { coverMessage: 'hi' } as any;
    const result = await controller.applyToRequest(user, 'sr1', dto);
    expect(service.applyToRequest).toHaveBeenCalledWith('u1', 'sr1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.APPLICATION_SUBMITTED);
  });

  it('getApplications calls service', async () => {
    const result = await controller.getApplications(user);
    expect(service.getApplications).toHaveBeenCalledWith('u1');
    expect(result.data).toHaveLength(1);
  });

  it('startRequest calls service', async () => {
    const result = await controller.startRequest(user, 'sr1');
    expect(service.startRequest).toHaveBeenCalledWith('u1', 'sr1');
    expect(result.message).toBe(SUCCESS_MESSAGES.SERVICE_REQUEST_UPDATED);
  });

  it('completeRequest calls service', async () => {
    const result = await controller.completeRequest(user, 'sr1');
    expect(service.completeRequest).toHaveBeenCalledWith('u1', 'sr1');
    expect(result.message).toBe(SUCCESS_MESSAGES.SERVICE_REQUEST_UPDATED);
  });
});
