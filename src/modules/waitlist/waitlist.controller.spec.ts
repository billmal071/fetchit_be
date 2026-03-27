import { Test, TestingModule } from '@nestjs/testing';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { PaginationDto } from '@common/dto/pagination.dto';

describe('WaitlistController', () => {
  let controller: WaitlistController;
  let waitlistService: Record<string, jest.Mock>;

  beforeEach(async () => {
    waitlistService = {
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      create: jest.fn().mockResolvedValue({ id: 'w1', email: 'a@b.com' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WaitlistController],
      providers: [{ provide: WaitlistService, useValue: waitlistService }],
    }).compile();

    controller = module.get(WaitlistController);
  });

  it('findAll should call waitlistService.findAll with pagination', async () => {
    const pagination = Object.assign(new PaginationDto(), { page: 1, limit: 10 });
    await controller.findAll(pagination);
    expect(waitlistService.findAll).toHaveBeenCalledWith(pagination);
  });

  it('create should call waitlistService.create and return message', async () => {
    const dto = { fullName: 'Test', email: 'a@b.com', role: 'USER' } as any;
    const result = await controller.create(dto);
    expect(waitlistService.create).toHaveBeenCalledWith(dto);
    expect(result.message).toBe('Successfully joined the waitlist');
    expect(result.data).toBeDefined();
  });
});
