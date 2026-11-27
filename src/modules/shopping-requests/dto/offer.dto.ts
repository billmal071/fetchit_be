import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RawValue } from './raw-value';

/**
 * A shopper bids their fee and ETA only. Item prices, services and the
 * delivery fee are not part of a bid: the server calculates every other line.
 * (docs/backend-feature-requirements.md B9 overrides the older per-item body.)
 */
export class OfferInputDto {
  @ApiProperty({
    description: 'Whole NGN. Must lie within the configured minimum and maximum shopper fee.',
    example: 1500,
  })
  @RawValue()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  shopperFee: number;

  @ApiProperty({ description: 'Minutes until the shopper can start', example: 45, minimum: 1 })
  @RawValue()
  @IsInt()
  @Min(1)
  @Max(1440)
  etaMinutes: number;

  @ApiPropertyOptional({ example: 'I am at the market now' })
  @RawValue()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
