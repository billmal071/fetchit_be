import { Test, TestingModule } from '@nestjs/testing';
import { WaitlistService } from './waitlist.service';
import { IWaitlistRepository, WAITLIST_REPOSITORY } from '@/database/repositories';
import { ConflictException } from '@/common/exceptions';
import {
  WaitlistRoleDto,
  HowFindHelpDto,
  FirstServiceDto,
  WillingToPayDto,
  MonthlyBudgetDto,
  UsedOwnMoneyDto,
  MaxSpendingAmountDto,
  PayoutSpeedDto,
} from './dto';

const mockEntry = {
  id: 'entry-1',
  fullName: 'John Doe',
  email: 'john@example.com',
  city: 'Lagos',
  role: 'USER',
  howFindHelp: 'SOCIAL_MEDIA',
  firstService: 'HANDYMAN',
  frustration: 'Hard to find reliable help',
  mainSkill: null,
  willingToPay: null,
  monthlyBudget: null,
  usedOwnMoney: null,
  maxSpendingAmount: null,
  payoutSpeed: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WaitlistService', () => {
  let service: WaitlistService;
  let waitlistRepository: jest.Mocked<IWaitlistRepository>;

  beforeEach(async () => {
    waitlistRepository = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      emailExists: jest.fn(),
      findByRole: jest.fn(),
      countByRole: jest.fn(),
    } as unknown as jest.Mocked<IWaitlistRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [WaitlistService, { provide: WAITLIST_REPOSITORY, useValue: waitlistRepository }],
    }).compile();

    service = module.get<WaitlistService>(WaitlistService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a waitlist entry with USER role', async () => {
      const dto = {
        fullName: 'John Doe',
        email: 'john@example.com',
        city: 'Lagos',
        role: WaitlistRoleDto.USER,
        howFindHelp: HowFindHelpDto.SOCIAL_MEDIA,
        firstService: FirstServiceDto.HANDYMAN,
        frustration: 'Hard to find reliable help',
      };

      waitlistRepository.findByEmail.mockResolvedValue(null);
      waitlistRepository.create.mockResolvedValue(mockEntry as any);

      const result = await service.create(dto);

      expect(waitlistRepository.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(waitlistRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'John Doe',
          email: 'john@example.com',
          city: 'Lagos',
          role: 'USER',
          howFindHelp: 'SOCIAL_MEDIA',
          firstService: 'HANDYMAN',
          frustration: 'Hard to find reliable help',
        }),
      );
      expect(result).toHaveProperty('id', 'entry-1');
    });

    it('should throw ConflictException when email already on waitlist', async () => {
      const dto = {
        fullName: 'John Doe',
        email: 'john@example.com',
        city: 'Lagos',
        role: WaitlistRoleDto.USER,
        howFindHelp: HowFindHelpDto.SOCIAL_MEDIA,
        firstService: FirstServiceDto.HANDYMAN,
      };

      waitlistRepository.findByEmail.mockResolvedValue(mockEntry as any);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(waitlistRepository.create).not.toHaveBeenCalled();
    });

    it('should create entry with HANDYMAN role and handyman-specific fields', async () => {
      const handymanEntry = {
        ...mockEntry,
        role: 'HANDYMAN',
        howFindHelp: null,
        firstService: null,
        frustration: null,
        mainSkill: 'Plumbing',
        willingToPay: 'YES',
        monthlyBudget: 'BUDGET_3000_5000',
      };

      const dto = {
        fullName: 'John Doe',
        email: 'john@example.com',
        city: 'Lagos',
        role: WaitlistRoleDto.HANDYMAN,
        mainSkill: 'Plumbing',
        willingToPay: WillingToPayDto.YES,
        monthlyBudget: MonthlyBudgetDto.BUDGET_3000_5000,
      };

      waitlistRepository.findByEmail.mockResolvedValue(null);
      waitlistRepository.create.mockResolvedValue(handymanEntry as any);

      const result = await service.create(dto);

      expect(waitlistRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'HANDYMAN',
          mainSkill: 'Plumbing',
          willingToPay: 'YES',
          monthlyBudget: 'BUDGET_3000_5000',
          howFindHelp: null,
          firstService: null,
          frustration: null,
        }),
      );
      expect(result).toHaveProperty('id', 'entry-1');
    });

    it('should create entry with SHOPPER role and shopper-specific fields', async () => {
      const shopperEntry = {
        ...mockEntry,
        role: 'SHOPPER',
        howFindHelp: null,
        firstService: null,
        frustration: null,
        usedOwnMoney: 'YES',
        maxSpendingAmount: 'AMOUNT_10000_30000',
        payoutSpeed: 'SAME_DAY',
      };

      const dto = {
        fullName: 'John Doe',
        email: 'john@example.com',
        city: 'Lagos',
        role: WaitlistRoleDto.SHOPPER,
        usedOwnMoney: UsedOwnMoneyDto.YES,
        maxSpendingAmount: MaxSpendingAmountDto.AMOUNT_10000_30000,
        payoutSpeed: PayoutSpeedDto.SAME_DAY,
      };

      waitlistRepository.findByEmail.mockResolvedValue(null);
      waitlistRepository.create.mockResolvedValue(shopperEntry as any);

      const result = await service.create(dto);

      expect(waitlistRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'SHOPPER',
          usedOwnMoney: 'YES',
          maxSpendingAmount: 'AMOUNT_10000_30000',
          payoutSpeed: 'SAME_DAY',
          mainSkill: null,
          willingToPay: null,
          monthlyBudget: null,
        }),
      );
      expect(result).toHaveProperty('id', 'entry-1');
    });

    it('should set optional user fields to null when not provided', async () => {
      const dto = {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        city: 'Abuja',
        role: WaitlistRoleDto.USER,
        howFindHelp: HowFindHelpDto.WHATSAPP,
        firstService: FirstServiceDto.BOTH,
      };

      waitlistRepository.findByEmail.mockResolvedValue(null);
      waitlistRepository.create.mockResolvedValue({ ...mockEntry, frustration: null } as any);

      await service.create(dto);

      expect(waitlistRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frustration: null,
          mainSkill: null,
          willingToPay: null,
          monthlyBudget: null,
          usedOwnMoney: null,
          maxSpendingAmount: null,
          payoutSpeed: null,
        }),
      );
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated admin response', async () => {
      const entries = [mockEntry];
      waitlistRepository.findAll.mockResolvedValue(entries as any);
      waitlistRepository.count.mockResolvedValue(1);

      const paginationDto = { page: 1, limit: 10, skip: 0 } as any;
      const result = await service.findAll(paginationDto);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual(
        expect.objectContaining({
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        }),
      );
    });

    it('should return empty data when no entries exist', async () => {
      waitlistRepository.findAll.mockResolvedValue([]);
      waitlistRepository.count.mockResolvedValue(0);

      const paginationDto = { page: 1, limit: 10, skip: 0 } as any;
      const result = await service.findAll(paginationDto);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('should pass correct pagination options to repository', async () => {
      waitlistRepository.findAll.mockResolvedValue([]);
      waitlistRepository.count.mockResolvedValue(0);

      const paginationDto = {
        page: 2,
        limit: 5,
        sortBy: 'email',
        sortOrder: 'ASC' as const,
        skip: 5,
      } as any;

      await service.findAll(paginationDto);

      expect(waitlistRepository.findAll).toHaveBeenCalledWith({
        skip: 5,
        take: 5,
        orderBy: { email: 'asc' },
      });
    });
  });
});
