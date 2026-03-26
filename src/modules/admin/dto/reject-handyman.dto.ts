import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectHandymanDto {
  @ApiProperty({
    description: 'Reason for rejection',
    example: 'Submitted documents are expired. Please upload valid identification.',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
