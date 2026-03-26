import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Category name', example: 'Plumbing' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

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

  @ApiPropertyOptional({ description: 'Whether the category is active', example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
