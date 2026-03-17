import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ApplyServiceRequestDto {
  @IsString()
  @IsOptional()
  coverMessage?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  proposedRate?: number;
}
