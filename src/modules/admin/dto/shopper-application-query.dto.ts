import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ShopperAccountState } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';

export class ShopperApplicationQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ShopperAccountState,
    default: ShopperAccountState.VERIFICATION_PENDING,
    description: 'Which accounts to list. Defaults to the ones awaiting review.',
  })
  @IsOptional()
  @IsEnum(ShopperAccountState)
  state?: ShopperAccountState;
}
