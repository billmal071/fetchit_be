import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { UserRole } from '@/common/enums';

export const ONBOARDABLE_ROLES = [
  UserRole.CUSTOMER,
  UserRole.PERSONAL_SHOPPER,
  UserRole.HANDYMAN,
] as const;

export type OnboardableRole = (typeof ONBOARDABLE_ROLES)[number];

export class OnboardUserDto {
  @ApiProperty({
    enum: ONBOARDABLE_ROLES,
    description: 'The role to onboard the user as',
    example: 'CUSTOMER',
  })
  @IsIn(ONBOARDABLE_ROLES, {
    message: `role must be one of: ${['CUSTOMER', 'PERSONAL_SHOPPER', 'HANDYMAN'].join(', ')}`,
  })
  role: OnboardableRole;
}
