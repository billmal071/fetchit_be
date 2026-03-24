import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@common/dto/pagination.dto';

export class HandymanServiceRequestQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['ongoing', 'completed'],
    description: 'Filter service requests by status',
  })
  @IsOptional()
  @IsIn(['ongoing', 'completed'])
  filter?: 'ongoing' | 'completed';
}
