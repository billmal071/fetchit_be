import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class UpdateCategoryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  icon?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
