import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';
import { REGEX_PATTERNS } from '@/common/constants';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Password reset token from email',
    example: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'NewPassword@123',
    description:
      'New password must be at least 8 characters with uppercase, lowercase, number, and special character',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(REGEX_PATTERNS.PASSWORD, {
    message:
      'Password must contain at least 8 characters, one uppercase, one lowercase, one number and one special character',
  })
  password: string;

  @ApiProperty({ example: 'NewPassword@123', description: 'Confirm new password' })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}
