import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REGEX_PATTERNS } from '@/common/constants';

export class CreateUserDto {
  @ApiProperty({ example: 'johndoe', description: 'Unique username' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username can only contain letters, numbers, and underscores',
  })
  username: string;

  @ApiProperty({ example: 'john.doe@example.com', description: 'User email address' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description:
      'Password must be at least 8 characters with uppercase, lowercase, number, and special character',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(REGEX_PATTERNS.PASSWORD, {
    message:
      'Password must contain at least 8 characters, one uppercase, one lowercase, one number and one special character',
  })
  password: string;

  @ApiPropertyOptional({ example: '+1234567890', description: 'User phone number' })
  @IsString()
  @IsOptional()
  @Matches(REGEX_PATTERNS.PHONE, { message: 'Invalid phone number format' })
  phone?: string;
}
