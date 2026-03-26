import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UserStatus } from '@/common/enums';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'email'] as const),
) {
  @ApiPropertyOptional({
    description: 'User avatar URL',
    example: 'https://storage.fetchit.com/avatars/johndoe.jpg',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  avatar?: string;

  @ApiPropertyOptional({ enum: UserStatus, description: 'User status', example: 'ACTIVE' })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}
