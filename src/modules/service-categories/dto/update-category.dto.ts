import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Category name', example: 'Plumbing' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Category description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Category icon identifier' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional({ description: 'Whether the category is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
