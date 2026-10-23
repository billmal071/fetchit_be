import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@common/dto/pagination.dto';
import { ServiceRequestStatus } from '@prisma/client';

export class ServiceRequestQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ServiceRequestStatus,
    description: 'Filter by status',
    example: 'OPEN',
  })
  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;
}
