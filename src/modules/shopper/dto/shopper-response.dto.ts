import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShopperAccountState, Weekday } from '@prisma/client';

export class ShoppingCategoryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() slug?: string;
  @ApiPropertyOptional() icon?: string;
}

export class ShoppingLocationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() state?: string;
}

export class ExtraServiceResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional({ description: 'Whole NGN, configured by Fetchit' }) fee?: number;
}

export class AvailabilityResponseDto {
  @ApiProperty({ enum: Weekday }) weekday: Weekday;
  @ApiPropertyOptional() startTime?: string;
  @ApiPropertyOptional() endTime?: string;
}

export class ShopperProfileResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty({ enum: ShopperAccountState }) accountState: ShopperAccountState;
  @ApiPropertyOptional() displayName?: string;
  @ApiPropertyOptional() bio?: string;
  @ApiPropertyOptional() yearsOfExperience?: number;
  @ApiPropertyOptional() avatarUrl?: string;
  @ApiProperty() isOnline: boolean;
  @ApiProperty({ type: [ShoppingCategoryResponseDto] }) categories: ShoppingCategoryResponseDto[];
  @ApiProperty({ type: [ShoppingLocationResponseDto] }) locations: ShoppingLocationResponseDto[];
  @ApiProperty({ type: [ExtraServiceResponseDto] }) services: ExtraServiceResponseDto[];
  @ApiProperty({ type: [AvailabilityResponseDto] }) availability: AvailabilityResponseDto[];
  @ApiPropertyOptional() rating?: number;
  @ApiProperty() completedOrders: number;
  @ApiPropertyOptional() completionRate?: number;
  @ApiProperty() payoutAccountVerified: boolean;
  @ApiPropertyOptional() rejectionReason?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
