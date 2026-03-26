import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Plumbing' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Category description',
    example: 'All plumbing related services including pipe repairs, installations, and maintenance',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Category icon identifier', example: 'wrench' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  icon?: string;
}
