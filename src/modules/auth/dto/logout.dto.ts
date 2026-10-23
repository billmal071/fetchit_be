import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'The current session refresh token. Omit to log out of every device instead of just this one.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
