import { ApiProperty } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ description: 'Category ID' })
  id: string;

  @ApiProperty({ description: 'Category name' })
  name: string;

  @ApiProperty({ description: 'URL-friendly slug' })
  slug: string;

  @ApiProperty({ description: 'Category description', required: false })
  description?: string;

  @ApiProperty({ description: 'Category icon identifier', required: false })
  icon?: string;

  @ApiProperty({ description: 'Whether the category is active' })
  isActive: boolean;
}
