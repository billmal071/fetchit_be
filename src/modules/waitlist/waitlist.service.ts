import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  WaitlistRole,
  HowFindHelp,
  FirstService,
  WillingToPay,
  MonthlyBudget,
  UsedOwnMoney,
  MaxSpendingAmount,
  PayoutSpeed,
} from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { ConflictException } from '@/common/exceptions';
import {
  CreateWaitlistDto,
  WaitlistResponseDto,
  WaitlistAdminResponseDto,
  WaitlistRoleDto,
  HowFindHelpDto,
  FirstServiceDto,
  WillingToPayDto,
  MonthlyBudgetDto,
  UsedOwnMoneyDto,
  MaxSpendingAmountDto,
  PayoutSpeedDto,
} from './dto';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { IPaginatedResult } from '@/common/interfaces';
import { createPaginationMeta } from '@/common/utils/pagination.util';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createWaitlistDto: CreateWaitlistDto): Promise<WaitlistResponseDto> {
    const existingEntry = await this.prisma.waitlist.findUnique({
      where: { email: createWaitlistDto.email },
    });

    if (existingEntry) {
      throw new ConflictException('This email is already on the waitlist');
    }

    const waitlistEntry = await this.prisma.waitlist.create({
      data: {
        fullName: createWaitlistDto.fullName,
        email: createWaitlistDto.email,
        city: createWaitlistDto.city,
        role: this.mapRole(createWaitlistDto.role),
        // User fields
        howFindHelp: createWaitlistDto.howFindHelp
          ? this.mapHowFindHelp(createWaitlistDto.howFindHelp)
          : null,
        firstService: createWaitlistDto.firstService
          ? this.mapFirstService(createWaitlistDto.firstService)
          : null,
        frustration: createWaitlistDto.frustration || null,
        // Handyman fields
        mainSkill: createWaitlistDto.mainSkill || null,
        willingToPay: createWaitlistDto.willingToPay
          ? this.mapWillingToPay(createWaitlistDto.willingToPay)
          : null,
        monthlyBudget: createWaitlistDto.monthlyBudget
          ? this.mapMonthlyBudget(createWaitlistDto.monthlyBudget)
          : null,
        // Shopper fields
        usedOwnMoney: createWaitlistDto.usedOwnMoney
          ? this.mapUsedOwnMoney(createWaitlistDto.usedOwnMoney)
          : null,
        maxSpendingAmount: createWaitlistDto.maxSpendingAmount
          ? this.mapMaxSpendingAmount(createWaitlistDto.maxSpendingAmount)
          : null,
        payoutSpeed: createWaitlistDto.payoutSpeed
          ? this.mapPayoutSpeed(createWaitlistDto.payoutSpeed)
          : null,
      },
    });

    this.logger.log(`Waitlist entry created with id: ${waitlistEntry.id}, role: ${waitlistEntry.role}`);

    return plainToInstance(WaitlistResponseDto, waitlistEntry);
  }

  async findAll(paginationDto: PaginationDto): Promise<IPaginatedResult<WaitlistAdminResponseDto>> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC' } = paginationDto;

    const [entries, total] = await Promise.all([
      this.prisma.waitlist.findMany({
        skip: paginationDto.skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder.toLowerCase(),
        },
      }),
      this.prisma.waitlist.count(),
    ]);

    return {
      data: entries.map((entry) => plainToInstance(WaitlistAdminResponseDto, entry)),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  private mapRole(role: WaitlistRoleDto): WaitlistRole {
    const mapping: Record<WaitlistRoleDto, WaitlistRole> = {
      [WaitlistRoleDto.USER]: WaitlistRole.USER,
      [WaitlistRoleDto.HANDYMAN]: WaitlistRole.HANDYMAN,
      [WaitlistRoleDto.SHOPPER]: WaitlistRole.SHOPPER,
    };
    return mapping[role];
  }

  private mapHowFindHelp(value: HowFindHelpDto): HowFindHelp {
    const mapping: Record<HowFindHelpDto, HowFindHelp> = {
      [HowFindHelpDto.FRIENDS_FAMILY]: HowFindHelp.FRIENDS_FAMILY,
      [HowFindHelpDto.WHATSAPP]: HowFindHelp.WHATSAPP,
      [HowFindHelpDto.SOCIAL_MEDIA]: HowFindHelp.SOCIAL_MEDIA,
      [HowFindHelpDto.STRUGGLE]: HowFindHelp.STRUGGLE,
    };
    return mapping[value];
  }

  private mapFirstService(value: FirstServiceDto): FirstService {
    const mapping: Record<FirstServiceDto, FirstService> = {
      [FirstServiceDto.HANDYMAN]: FirstService.HANDYMAN,
      [FirstServiceDto.PERSONAL_SHOPPER]: FirstService.PERSONAL_SHOPPER,
      [FirstServiceDto.BOTH]: FirstService.BOTH,
    };
    return mapping[value];
  }

  private mapWillingToPay(value: WillingToPayDto): WillingToPay {
    const mapping: Record<WillingToPayDto, WillingToPay> = {
      [WillingToPayDto.YES]: WillingToPay.YES,
      [WillingToPayDto.MAYBE]: WillingToPay.MAYBE,
      [WillingToPayDto.NO]: WillingToPay.NO,
    };
    return mapping[value];
  }

  private mapMonthlyBudget(value: MonthlyBudgetDto): MonthlyBudget {
    const mapping: Record<MonthlyBudgetDto, MonthlyBudget> = {
      [MonthlyBudgetDto.BUDGET_1000_3000]: MonthlyBudget.BUDGET_1000_3000,
      [MonthlyBudgetDto.BUDGET_3000_5000]: MonthlyBudget.BUDGET_3000_5000,
      [MonthlyBudgetDto.BUDGET_5000_PLUS]: MonthlyBudget.BUDGET_5000_PLUS,
    };
    return mapping[value];
  }

  private mapUsedOwnMoney(value: UsedOwnMoneyDto): UsedOwnMoney {
    const mapping: Record<UsedOwnMoneyDto, UsedOwnMoney> = {
      [UsedOwnMoneyDto.YES]: UsedOwnMoney.YES,
      [UsedOwnMoneyDto.NO]: UsedOwnMoney.NO,
    };
    return mapping[value];
  }

  private mapMaxSpendingAmount(value: MaxSpendingAmountDto): MaxSpendingAmount {
    const mapping: Record<MaxSpendingAmountDto, MaxSpendingAmount> = {
      [MaxSpendingAmountDto.UNDER_10000]: MaxSpendingAmount.UNDER_10000,
      [MaxSpendingAmountDto.AMOUNT_10000_30000]: MaxSpendingAmount.AMOUNT_10000_30000,
      [MaxSpendingAmountDto.AMOUNT_30000_PLUS]: MaxSpendingAmount.AMOUNT_30000_PLUS,
    };
    return mapping[value];
  }

  private mapPayoutSpeed(value: PayoutSpeedDto): PayoutSpeed {
    const mapping: Record<PayoutSpeedDto, PayoutSpeed> = {
      [PayoutSpeedDto.IMMEDIATELY]: PayoutSpeed.IMMEDIATELY,
      [PayoutSpeedDto.SAME_DAY]: PayoutSpeed.SAME_DAY,
      [PayoutSpeedDto.WITHIN_24_HOURS]: PayoutSpeed.WITHIN_24_HOURS,
    };
    return mapping[value];
  }
}
