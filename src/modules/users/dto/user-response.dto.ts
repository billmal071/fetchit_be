import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { UserRole, UserStatus } from '@/common/enums';

@Exclude()
export class UserResponseDto {
  @Expose()
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @Expose()
  @ApiProperty({ example: 'johndoe' })
  username: string;

  @Expose()
  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @Expose()
  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;

  @Expose()
  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @Expose()
  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  avatar?: string;

  @Expose()
  @ApiPropertyOptional({ example: '+1234567890' })
  phone?: string;

  @Expose()
  @ApiProperty({ example: true })
  emailVerified: boolean;

  @Expose()
  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt: Date;

  @Expose()
  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  updatedAt: Date;

  @Expose()
  @ApiPropertyOptional({ example: '2024-01-15T10:30:00.000Z' })
  lastLoginAt?: Date;
}
