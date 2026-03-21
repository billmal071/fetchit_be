import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApplyServiceRequestDto {
  @ApiPropertyOptional({ description: 'Message to the customer explaining why you are a good fit' })
  @IsString()
  @IsOptional()
  coverMessage?: string;

  @ApiPropertyOptional({ description: 'Proposed rate in NGN', example: 5000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  proposedRate?: number;
}
