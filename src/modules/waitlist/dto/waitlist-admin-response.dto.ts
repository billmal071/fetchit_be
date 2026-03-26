import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WaitlistAdminResponseDto {
  @Expose()
  @ApiProperty({
    description: 'Waitlist entry ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @Expose()
  @ApiProperty({ description: 'Full name', example: 'John Doe' })
  fullName: string;

  @Expose()
  @ApiProperty({ description: 'Email address', example: 'john@example.com' })
  email: string;

  @Expose()
  @ApiProperty({ description: 'City', example: 'Lagos' })
  city: string;

  @Expose()
  @ApiProperty({
    description: 'Waitlist role',
    enum: ['USER', 'HANDYMAN', 'SHOPPER'],
    example: 'USER',
  })
  role: string;

  // User-specific fields
  @Expose()
  @ApiPropertyOptional({ description: 'How the user finds help', example: 'friends_family' })
  howFindHelp?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'First service preference', example: 'handyman' })
  firstService?: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'User frustration',
    example: 'It is hard to find reliable handymen in my area',
  })
  frustration?: string;

  // Handyman-specific fields
  @Expose()
  @ApiPropertyOptional({ description: 'Main skill', example: 'Plumbing' })
  mainSkill?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Willing to pay for leads', example: 'yes' })
  willingToPay?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Monthly budget', example: '3000-5000' })
  monthlyBudget?: string;

  // Shopper-specific fields
  @Expose()
  @ApiPropertyOptional({ description: 'Has used own money for shopping', example: 'yes' })
  usedOwnMoney?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Maximum spending amount', example: '10000-30000' })
  maxSpendingAmount?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'Payout speed preference', example: 'same_day' })
  payoutSpeed?: string;

  @Expose()
  @ApiProperty({ description: 'Created at timestamp', example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;

  @Expose()
  @ApiProperty({ description: 'Updated at timestamp', example: '2024-01-15T10:30:00.000Z' })
  updatedAt: Date;
}
