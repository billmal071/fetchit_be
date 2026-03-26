import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '@/modules/users/dto';

export class TokensDto {
  @ApiProperty({
    description: 'JWT access token',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2NTU0NDAwMDAiLCJpYXQiOjE3MDAwMDAwMDB9.abc123',
  })
  accessToken: string;

  @ApiProperty({
    description: 'JWT refresh token',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2NTU0NDAwMDAiLCJpYXQiOjE3MDAwMDAwMDB9.xyz789',
  })
  refreshToken: string;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ type: TokensDto })
  tokens: TokensDto;
}
