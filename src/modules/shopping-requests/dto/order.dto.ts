import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderItemState, OrderState, SubstitutionPreference } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { TrimmedValue } from './raw-value';
import {
  DeliveryAddressResponseDto,
  LocationSummaryDto,
  OfferBreakdownResponseDto,
  ShopperPublicDto,
} from './shopping-response.dto';

export const ORDER_LIST_FILTERS = ['active', 'completed', 'cancelled'] as const;

export class OrderQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ORDER_LIST_FILTERS,
    description: 'active = not COMPLETED or CANCELLED',
  })
  @IsOptional()
  @IsIn(ORDER_LIST_FILTERS)
  filter?: (typeof ORDER_LIST_FILTERS)[number];
}

export class CancelOrderDto {
  @ApiPropertyOptional({
    description: 'Why the order is being cancelled. Shown to you, never to the shopper.',
    maxLength: 500,
  })
  @TrimmedValue()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class OrderItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() brand: string;
  @ApiProperty() size: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unit: string;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty({ enum: OrderItemState }) state: OrderItemState;
  @ApiProperty({ enum: SubstitutionPreference }) substitutionPreference: SubstitutionPreference;
  @ApiPropertyOptional() maxSubstitutePrice?: number;
  @ApiProperty({ description: 'Whole NGN per unit, as the customer estimated' })
  customerEstimatedPrice: number;
  @ApiPropertyOptional({ description: 'Absent until set; absent is not zero' })
  shopperEstimatedPrice?: number;
  @ApiPropertyOptional({ description: 'Recorded by the shopper; not authoritative' })
  actualPurchasePrice?: number;
  @ApiPropertyOptional({ description: 'Authoritative once the customer approves' })
  approvedPrice?: number;
  @ApiPropertyOptional({ description: 'Set at settlement' }) finalPurchasePrice?: number;
}

export class OrderEventResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'OFFER_ACCEPTED' }) type: string;
  @ApiPropertyOptional() actorRole?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;
  @ApiProperty() createdAt: string;
}

export class CustomerOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'SO-K7M2QX9D' }) reference: string;
  @ApiProperty() requestId: string;
  @ApiProperty() requestReference: string;
  @ApiProperty({ enum: OrderState }) state: OrderState;
  @ApiProperty({ type: LocationSummaryDto }) shoppingLocation: LocationSummaryDto;
  @ApiPropertyOptional() handoffArea?: string;
  @ApiPropertyOptional() handoffAt?: string;
  @ApiProperty({ type: DeliveryAddressResponseDto }) deliveryAddress: DeliveryAddressResponseDto;
  @ApiPropertyOptional() note?: string;
  @ApiProperty({ type: [OrderItemResponseDto] }) items: OrderItemResponseDto[];
  @ApiProperty() itemCount: number;
  @ApiProperty({
    type: OfferBreakdownResponseDto,
    description: "The accepted offer's breakdown, copied as quoted. Not payable yet (Part C).",
  })
  financials: OfferBreakdownResponseDto;
  @ApiProperty({ type: ShopperPublicDto }) shopper: ShopperPublicDto;
  @ApiPropertyOptional() cancelledAt?: string;
  @ApiPropertyOptional({ enum: ['CUSTOMER', 'SYSTEM', 'SHOPPER'] }) cancelledBy?: string;
  @ApiPropertyOptional({ description: 'Your own reason, or the system reason on timeout' })
  cancelReason?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class CustomerOrderDetailResponseDto extends CustomerOrderResponseDto {
  @ApiProperty({ type: [OrderEventResponseDto], description: 'Newest first' })
  events: OrderEventResponseDto[];
}

export class ShopperOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'SO-K7M2QX9D' }) reference: string;
  @ApiProperty({ enum: OrderState }) state: OrderState;
  @ApiProperty({ type: LocationSummaryDto }) shoppingLocation: LocationSummaryDto;
  @ApiPropertyOptional({
    description:
      'Coarse area only. The exact address, coordinates and the customer note are not shown to the shopper.',
  })
  handoffArea?: string;
  @ApiPropertyOptional() handoffAt?: string;
  @ApiProperty({ type: [OrderItemResponseDto] }) items: OrderItemResponseDto[];
  @ApiProperty() itemCount: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Empty until a later slice',
  })
  extraServices: unknown[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Empty until a later slice',
  })
  receipts: unknown[];
  @ApiProperty({ type: OfferBreakdownResponseDto }) financials: OfferBreakdownResponseDto;
  @ApiProperty({ description: '0 until price-change approvals exist' }) pendingApprovals: number;
  @ApiPropertyOptional() acceptedAt?: string;
  @ApiPropertyOptional() startedAt?: string;
  @ApiPropertyOptional() cancelledAt?: string;
  @ApiPropertyOptional({
    enum: ['CUSTOMER', 'SYSTEM', 'SHOPPER'],
    description: 'Who cancelled it. The reason is never sent to the shopper.',
  })
  cancelledBy?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
