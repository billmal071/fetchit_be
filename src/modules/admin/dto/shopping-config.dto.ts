import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, Max, Min, ValidateIf } from 'class-validator';
import { RawValue } from '@modules/shopping-requests/dto/raw-value';
import { MAX_FEE, MAX_PERCENT, MAX_WINDOW_MINUTES } from '../admin-shopping-config.validation';

class UpdatedByDto {
  @ApiProperty() id: string;
  @ApiProperty() username: string;
}

export class ShoppingConfigResponseDto {
  @ApiProperty({ description: 'Whole NGN. The lowest shopper fee a bid may carry.', example: 500 })
  minShopperFee: number;
  @ApiProperty({
    description: 'Whole NGN. The highest shopper fee a bid may carry.',
    example: 5000,
  })
  maxShopperFee: number;
  @ApiProperty({ description: 'Whole NGN, the flat delivery fee on every request.', example: 1500 })
  deliveryFee: number;
  @ApiProperty({ description: 'Percent of the goods estimate (7.5 = 7.5%).', example: 5 })
  serviceChargePercent: number;
  @ApiProperty({
    description: 'Percent, charged on the service lines (not the goods).',
    example: 7.5,
  })
  vatPercent: number;
  @ApiProperty({ description: 'Percent of the goods estimate, a refundable cushion.', example: 10 })
  priceBufferPercent: number;
  @ApiProperty({
    description: 'Minutes bidding stays open on a new (or reopened) request.',
    example: 30,
  })
  offerWindowMinutes: number;
  @ApiProperty({ description: 'Minutes a shopper has to accept an ASSIGNED order.', example: 30 })
  shopperAcceptWindowMinutes: number;
  @ApiProperty({
    description:
      'Minutes an offer stays acceptable after bidding closes. New requests copy this value when created or reopened; existing requests keep theirs.',
    example: 1440,
  })
  offerAcceptanceWindowMinutes: number;
  @ApiProperty({ description: 'When the configuration was last changed.' })
  updatedAt: string;
  @ApiProperty({
    type: UpdatedByDto,
    nullable: true,
    description: 'The admin who last changed it; null for the seeded values.',
  })
  updatedBy: UpdatedByDto | null;
}

const fee = (description: string) =>
  ApiPropertyOptional({ description, minimum: 0, maximum: MAX_FEE, type: 'integer' });
const percent = (description: string) =>
  ApiPropertyOptional({ description, minimum: 0, maximum: MAX_PERCENT, type: 'number' });
const window = (description: string) =>
  ApiPropertyOptional({ description, minimum: 1, maximum: MAX_WINDOW_MINUTES, type: 'integer' });

/**
 * A partial edit: send only the fields to change, at least one. Every number is
 * type-checked strictly (a string or boolean is a 400, not coerced).
 */
export class UpdateShoppingConfigDto {
  @fee('Whole NGN, 0 to 1,000,000,000. Must not exceed maxShopperFee once merged.')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  minShopperFee?: number;

  @fee('Whole NGN, 0 to 1,000,000,000. Must not be below minShopperFee once merged.')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  maxShopperFee?: number;

  @fee('Whole NGN, 0 to 1,000,000,000.')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  deliveryFee?: number;

  @percent('0 to 100, at most two decimal places (7.5 means 7.5%).')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_PERCENT)
  serviceChargePercent?: number;

  @percent('0 to 100, at most two decimal places.')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_PERCENT)
  vatPercent?: number;

  @percent('0 to 100, at most two decimal places.')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_PERCENT)
  priceBufferPercent?: number;

  @window('Minutes, 1 to 43,200 (30 days).')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsInt()
  @Min(1)
  @Max(MAX_WINDOW_MINUTES)
  offerWindowMinutes?: number;

  @window('Minutes, 1 to 43,200 (30 days).')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsInt()
  @Min(1)
  @Max(MAX_WINDOW_MINUTES)
  shopperAcceptWindowMinutes?: number;

  @window('Minutes, 1 to 43,200 (30 days).')
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined) // absent = leave alone; null is an error
  @IsInt()
  @Min(1)
  @Max(MAX_WINDOW_MINUTES)
  offerAcceptanceWindowMinutes?: number;
}
