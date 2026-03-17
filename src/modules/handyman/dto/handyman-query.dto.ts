import { IsOptional, IsIn } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';

export class HandymanServiceRequestQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['ongoing', 'completed'])
  filter?: 'ongoing' | 'completed';
}
