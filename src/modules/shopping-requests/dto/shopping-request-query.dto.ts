import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShoppingOfferState, ShoppingRequestStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';

export class ShoppingRequestQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ShoppingRequestStatus })
  @IsOptional()
  @IsEnum(ShoppingRequestStatus)
  status?: ShoppingRequestStatus;
}

export class ShopperRequestQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Only requests at this market' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Only requests with an item in this category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'offerDeadline'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'offerDeadline'])
  sortBy?: 'createdAt' | 'offerDeadline';
}

export class ShopperOfferQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ShoppingOfferState })
  @IsOptional()
  @IsEnum(ShoppingOfferState)
  state?: ShoppingOfferState;
}
