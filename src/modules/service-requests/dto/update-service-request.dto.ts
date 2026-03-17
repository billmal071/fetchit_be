import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateServiceRequestDto } from './create-service-request.dto';

export class UpdateServiceRequestDto extends PartialType(
  OmitType(CreateServiceRequestDto, ['categoryId'] as const),
) {}
