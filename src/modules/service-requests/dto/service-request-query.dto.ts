import { IsOptional, IsEnum } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { ServiceRequestStatus } from '@prisma/client';

export class ServiceRequestQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;
}
