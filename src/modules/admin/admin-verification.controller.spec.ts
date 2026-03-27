import { Test, TestingModule } from '@nestjs/testing';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { SUCCESS_MESSAGES } from '@common/constants';
import { PaginationDto } from '@common/dto/pagination.dto';

const admin = { id: 'admin1', email: 'admin@test.com', role: 'ADMIN' } as any;
const mockProfile = { id: 'p1' };

describe('AdminVerificationController', () => {
  let controller: AdminVerificationController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getPendingHandymen: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      getHandymanForReview: jest.fn().mockResolvedValue(mockProfile),
      approveHandyman: jest.fn().mockResolvedValue(mockProfile),
      rejectHandyman: jest.fn().mockResolvedValue(mockProfile),
      reviewDocument: jest.fn().mockResolvedValue({ id: 'd1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminVerificationController],
      providers: [{ provide: AdminVerificationService, useValue: service }],
    }).compile();

    controller = module.get(AdminVerificationController);
  });

  it('getPendingHandymen calls service with pagination', async () => {
    const pagination = Object.assign(new PaginationDto(), { page: 1, limit: 10 });
    await controller.getPendingHandymen(pagination);
    expect(service.getPendingHandymen).toHaveBeenCalledWith(pagination);
  });

  it('getHandymanForReview calls service with id', async () => {
    const result = await controller.getHandymanForReview('p1');
    expect(service.getHandymanForReview).toHaveBeenCalledWith('p1');
    expect(result.data).toEqual(mockProfile);
  });

  it('approveHandyman calls service with id and admin id', async () => {
    const result = await controller.approveHandyman('p1', admin);
    expect(service.approveHandyman).toHaveBeenCalledWith('p1', 'admin1');
    expect(result.message).toBe(SUCCESS_MESSAGES.HANDYMAN_APPROVED);
  });

  it('rejectHandyman calls service with id, admin id, and dto', async () => {
    const dto = { reason: 'Invalid docs' } as any;
    const result = await controller.rejectHandyman('p1', dto, admin);
    expect(service.rejectHandyman).toHaveBeenCalledWith('p1', 'admin1', dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.HANDYMAN_REJECTED);
  });

  it('reviewDocument calls service with all params', async () => {
    const dto = { status: 'APPROVED' } as any;
    const result = await controller.reviewDocument('p1', 'd1', dto, admin);
    expect(service.reviewDocument).toHaveBeenCalledWith('p1', 'd1', 'admin1', dto);
    expect(result.message).toBe('Document reviewed successfully');
  });
});
