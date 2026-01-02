import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WaitlistAdminResponseDto {
  @Expose()
  @ApiProperty({ description: 'Waitlist entry ID' })
  id: string;

  @Expose()
  @ApiProperty({ description: 'Full name' })
  fullName: string;

  @Expose()
  @ApiProperty({ description: 'Email address' })
  email: string;

  @Expose()
  @ApiProperty({ description: 'City' })
  city: string;

  @Expose()
  @ApiProperty({ description: 'Waitlist role', enum: ['USER', 'HANDYMAN', 'SHOPPER'] })
  role: string;

  // User-specific fields
  @Expose()
  @ApiPropertyOptional({ description: 'How the user finds help' })
  howFindHelp?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'First service preference' })
  firstService?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'User frustration' })
  frustration?: string;

  // Handyman-specific fields
  @Expose()
  @ApiPropertyOptional({ description: 'Main skill' })
  mainSkill?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Willing to pay for leads' })
  willingToPay?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Monthly budget' })
  monthlyBudget?: string;

  // Shopper-specific fields
  @Expose()
  @ApiPropertyOptional({ description: 'Has used own money for shopping' })
  usedOwnMoney?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Maximum spending amount' })
  maxSpendingAmount?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Payout speed preference' })
  payoutSpeed?: string;

  @Expose()
  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @Expose()
  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;
}
