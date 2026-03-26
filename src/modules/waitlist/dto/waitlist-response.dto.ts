import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WaitlistResponseDto {
  @Expose()
  @ApiProperty({
    description: 'Waitlist entry ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @Expose()
  @ApiProperty({ description: 'Email address', example: 'john@example.com' })
  email: string;
}
