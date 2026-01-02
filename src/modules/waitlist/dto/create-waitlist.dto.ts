import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export enum WaitlistRoleDto {
  USER = 'user',
  HANDYMAN = 'handyman',
  SHOPPER = 'shopper',
}

export enum HowFindHelpDto {
  FRIENDS_FAMILY = 'friends_family',
  WHATSAPP = 'whatsapp',
  SOCIAL_MEDIA = 'social_media',
  STRUGGLE = 'struggle',
}

export enum FirstServiceDto {
  HANDYMAN = 'handyman',
  PERSONAL_SHOPPER = 'personal_shopper',
  BOTH = 'both',
}

export enum WillingToPayDto {
  YES = 'yes',
  MAYBE = 'maybe',
  NO = 'no',
}

export enum MonthlyBudgetDto {
  BUDGET_1000_3000 = '1000-3000',
  BUDGET_3000_5000 = '3000-5000',
  BUDGET_5000_PLUS = '5000+',
}

export enum UsedOwnMoneyDto {
  YES = 'yes',
  NO = 'no',
}

export enum MaxSpendingAmountDto {
  UNDER_10000 = 'under-10000',
  AMOUNT_10000_30000 = '10000-30000',
  AMOUNT_30000_PLUS = '30000+',
}

export enum PayoutSpeedDto {
  IMMEDIATELY = 'immediately',
  SAME_DAY = 'same_day',
  WITHIN_24_HOURS = 'within_24_hours',
}

export class CreateWaitlistDto {
  @ApiProperty({ example: 'John Doe', description: 'Full name of the person' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Lagos', description: 'City of residence' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @ApiProperty({ enum: WaitlistRoleDto, description: 'Role type: user, handyman, or shopper' })
  @IsEnum(WaitlistRoleDto)
  @IsNotEmpty()
  role: WaitlistRoleDto;

  // User-specific fields
  @ApiPropertyOptional({
    enum: HowFindHelpDto,
    description: 'How user currently finds help (user role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.USER)
  @IsEnum(HowFindHelpDto)
  @IsNotEmpty()
  howFindHelp?: HowFindHelpDto;

  @ApiPropertyOptional({
    enum: FirstServiceDto,
    description: 'First service user would try (user role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.USER)
  @IsEnum(FirstServiceDto)
  @IsNotEmpty()
  firstService?: FirstServiceDto;

  @ApiPropertyOptional({ description: 'User frustration description (user role only, optional)' })
  @IsString()
  @IsOptional()
  frustration?: string;

  // Handyman-specific fields
  @ApiPropertyOptional({ example: 'Plumbing', description: 'Main skill (handyman role only)' })
  @ValidateIf((o) => o.role === WaitlistRoleDto.HANDYMAN)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mainSkill?: string;

  @ApiPropertyOptional({
    enum: WillingToPayDto,
    description: 'Willing to pay for visibility (handyman role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.HANDYMAN)
  @IsEnum(WillingToPayDto)
  @IsNotEmpty()
  willingToPay?: WillingToPayDto;

  @ApiPropertyOptional({
    enum: MonthlyBudgetDto,
    description: 'Monthly budget in Naira (handyman role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.HANDYMAN)
  @IsEnum(MonthlyBudgetDto)
  @IsNotEmpty()
  monthlyBudget?: MonthlyBudgetDto;

  // Shopper-specific fields
  @ApiPropertyOptional({
    enum: UsedOwnMoneyDto,
    description: 'Has used own money for purchases (shopper role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.SHOPPER)
  @IsEnum(UsedOwnMoneyDto)
  @IsNotEmpty()
  usedOwnMoney?: UsedOwnMoneyDto;

  @ApiPropertyOptional({
    enum: MaxSpendingAmountDto,
    description: 'Maximum spending amount in Naira (shopper role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.SHOPPER)
  @IsEnum(MaxSpendingAmountDto)
  @IsNotEmpty()
  maxSpendingAmount?: MaxSpendingAmountDto;

  @ApiPropertyOptional({
    enum: PayoutSpeedDto,
    description: 'Preferred payout speed (shopper role only)',
  })
  @ValidateIf((o) => o.role === WaitlistRoleDto.SHOPPER)
  @IsEnum(PayoutSpeedDto)
  @IsNotEmpty()
  payoutSpeed?: PayoutSpeedDto;
}
