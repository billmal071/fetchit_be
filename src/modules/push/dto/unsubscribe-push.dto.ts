import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UnsubscribePushDto {
  @ApiProperty({ description: 'Endpoint of the subscription to remove', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint: string;
}
