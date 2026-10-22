import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { UserStatus } from '@/common/enums';
import { UpdateMeDto } from './update-me.dto';

/** `PATCH /users/:id` (admin only) — everything in `UpdateMeDto`, plus `status`. */
export class AdminUpdateUserDto extends UpdateMeDto {
  @ApiPropertyOptional({ enum: UserStatus, description: 'User status', example: 'ACTIVE' })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}
