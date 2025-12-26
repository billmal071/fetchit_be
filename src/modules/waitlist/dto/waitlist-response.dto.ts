import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WaitlistResponseDto {
  @Expose()
  @ApiProperty({ description: 'Waitlist entry ID' })
  id: string;

  @Expose()
  @ApiProperty({ description: 'Email address' })
  email: string;
}
