import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@common/dto/pagination.dto';
import { ServiceRequestStatus } from '@prisma/client';

export class ServiceRequestQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    description: 'Filter by status',
  })
  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;
}
