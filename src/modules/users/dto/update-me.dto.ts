import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * `PATCH /users/me` — the self-service subset of a user's own fields.
 *
 * Deliberately has no `status`: that's an admin-only control (suspension),
 * not something a user can set on themselves. See `AdminUpdateUserDto`.
 */
export class UpdateMeDto extends PartialType(
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
}
