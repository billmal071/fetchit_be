import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, IsIn } from 'class-validator';
import { API_CONSTANTS } from '../constants';

export class PaginationDto {
  @ApiPropertyOptional({
    description: 'Page number',
    default: API_CONSTANTS.DEFAULT_PAGE,
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = API_CONSTANTS.DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: API_CONSTANTS.DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: API_CONSTANTS.MAX_PAGE_SIZE,
    example: 10,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_CONSTANTS.MAX_PAGE_SIZE)
  @IsOptional()
  limit?: number = API_CONSTANTS.DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
  })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
    example: 'DESC',
  })
  @IsIn(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  get skip(): number {
    return ((this.page || 1) - 1) * (this.limit || API_CONSTANTS.DEFAULT_PAGE_SIZE);
  }
}
