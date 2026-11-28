import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShoppingOfferState, ShoppingRequestStatus, SubstitutionPreference } from '@prisma/client';

export class LocationSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() state?: string;
}

export class CategorySummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class RequestItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() brand: string;
  @ApiProperty() size: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unit: string;
  @ApiProperty({ description: 'Whole NGN per unit' }) estimatedUnitPrice: number;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty({ enum: SubstitutionPreference }) substitutionPreference: SubstitutionPreference;
  @ApiPropertyOptional() maxSubstitutePrice?: number;
  @ApiPropertyOptional({ type: CategorySummaryDto }) category?: CategorySummaryDto;
}

export class RequestEstimateResponseDto {
  @ApiProperty() estimatedGoodsCost: number;
  @ApiProperty() deliveryFee: number;
  @ApiProperty({ description: 'Fetchit service charge' }) platformFee: number;
  @ApiProperty() vatOrTax: number;
  @ApiProperty({ description: 'Everything except the shopper fee, which is set by bids' })
  estimatedTotal: number;
  @ApiProperty({ description: 'Refundable cushion for price increases; not in estimatedTotal' })
  priceBuffer: number;
  @ApiProperty({ example: true }) shopperFeePending: boolean;
}

export class OfferBreakdownResponseDto {
  @ApiProperty() estimatedGoodsCost: number;
  @ApiProperty() shopperFee: number;
  @ApiProperty() deliveryFee: number;
  @ApiProperty() platformFee: number;
  @ApiProperty() vatOrTax: number;
  @ApiProperty() customerTotal: number;
  @ApiProperty({ description: 'Refundable cushion for price increases; not in customerTotal' })
  priceBuffer: number;
  @ApiPropertyOptional({ description: 'Shopper-facing responses only' })
  shopperGrossEarnings?: number;
}

export class DeliveryAddressResponseDto {
  @ApiProperty() text: string;
  @ApiPropertyOptional() latitude?: number;
  @ApiPropertyOptional() longitude?: number;
}

export class ShopperPublicDto {
  @ApiProperty({ description: 'Shopper profile id' }) id: string;
  @ApiPropertyOptional() displayName?: string;
  @ApiPropertyOptional() avatarUrl?: string;
  @ApiPropertyOptional() rating?: number;
  @ApiProperty() completedOrders: number;
  @ApiPropertyOptional() completionRate?: number;
}

export class CustomerOfferResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ShoppingOfferState }) state: ShoppingOfferState;
  @ApiProperty() shopperFee: number;
  @ApiProperty() etaMinutes: number;
  @ApiPropertyOptional() note?: string;
  @ApiProperty({
    description:
      'The end of the offer acceptance window (after bidding closes); the customer can accept until then.',
  })
  expiresAt: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: OfferBreakdownResponseDto }) financials: OfferBreakdownResponseDto;
  @ApiProperty({ type: ShopperPublicDto }) shopper: ShopperPublicDto;
}

export class ShoppingRequestResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() reference: string;
  @ApiProperty({ enum: ShoppingRequestStatus }) status: ShoppingRequestStatus;
  @ApiProperty({ type: LocationSummaryDto }) shoppingLocation: LocationSummaryDto;
  @ApiProperty({ type: DeliveryAddressResponseDto }) deliveryAddress: DeliveryAddressResponseDto;
  @ApiPropertyOptional() handoffArea?: string;
  @ApiPropertyOptional() note?: string;
  @ApiProperty({ type: [RequestItemResponseDto] }) items: RequestItemResponseDto[];
  @ApiProperty() itemCount: number;
  @ApiProperty({ description: 'Whole NGN' }) estimatedGoodsBudget: number;
  @ApiProperty({ type: RequestEstimateResponseDto }) estimate: RequestEstimateResponseDto;
  @ApiProperty({
    description:
      'When BIDDING closes: no new offer or preview after it. Offers already placed stay acceptable until their own expiresAt.',
  })
  offerDeadline: string;
  @ApiProperty({ description: 'Same instant as offerDeadline, under a name that says what it is.' })
  biddingClosesAt: string;
  @ApiPropertyOptional({ description: 'Number of PENDING offers (list only)' })
  offerCount?: number;
  @ApiPropertyOptional() cancelledAt?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class ShoppingRequestDetailResponseDto extends ShoppingRequestResponseDto {
  @ApiProperty({
    type: [CustomerOfferResponseDto],
    description: 'Offers except withdrawn ones, cheapest shopper fee first',
  })
  offers: CustomerOfferResponseDto[];
}

export class ShopperRequestSummaryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() reference: string;
  @ApiProperty({ enum: ShoppingRequestStatus }) status: ShoppingRequestStatus;
  @ApiProperty({
    description:
      'When BIDDING closes: no new offer or preview after it. Offers already placed stay acceptable until their own expiresAt.',
  })
  offerDeadline: string;
  @ApiProperty({ description: 'Same instant as offerDeadline, under a name that says what it is.' })
  biddingClosesAt: string;
  @ApiProperty() itemCount: number;
  @ApiProperty({ description: 'Whole NGN' }) estimatedGoodsBudget: number;
  @ApiProperty({ type: LocationSummaryDto }) shoppingLocation: LocationSummaryDto;
  @ApiPropertyOptional() handoffArea?: string;
  @ApiProperty({ type: [CategorySummaryDto] }) categories: CategorySummaryDto[];
  @ApiProperty({
    description: 'Indicative earnings: the midpoint of the configured shopper-fee range',
  })
  earningsEstimate: number;
  @ApiProperty({ example: { min: 500, max: 5000 } })
  earningsRange: { min: number; max: number };
  @ApiProperty({ description: 'True when this shopper has a PENDING offer on the request' })
  hasSubmittedOffer: boolean;
  @ApiProperty() createdAt: string;
}

export class ShopperOfferResponseDto {
  @ApiPropertyOptional({ description: 'Absent on a preview' }) id?: string;
  @ApiProperty() requestId: string;
  @ApiProperty({ description: 'Shopper profile id' }) shopperId: string;
  @ApiProperty({ enum: ShoppingOfferState }) state: ShoppingOfferState;
  @ApiProperty() shopperFee: number;
  @ApiProperty() etaMinutes: number;
  @ApiPropertyOptional() note?: string;
  @ApiProperty({
    description:
      'The end of the offer acceptance window (after bidding closes); the customer can accept until then.',
  })
  expiresAt: string;
  @ApiPropertyOptional() createdAt?: string;
  @ApiProperty({ type: OfferBreakdownResponseDto }) financials: OfferBreakdownResponseDto;
}

export class ShopperOfferWithRequestResponseDto extends ShopperOfferResponseDto {
  @ApiProperty({ type: ShopperRequestSummaryResponseDto })
  request: ShopperRequestSummaryResponseDto;
}

export class ShopperRequestDetailResponseDto extends ShopperRequestSummaryResponseDto {
  @ApiProperty({ type: [RequestItemResponseDto] }) items: RequestItemResponseDto[];
  @ApiPropertyOptional({
    type: ShopperOfferResponseDto,
    description: "The shopper's PENDING offer on this request, if any",
  })
  myOffer?: ShopperOfferResponseDto;
}
