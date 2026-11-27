import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubstitutionPreference } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { RawValue, TrimmedValue } from './raw-value';

export const MAX_REQUEST_ITEMS = 50;

@ValidatorConstraint({ name: 'maxSubstitutePriceMatchesPreference', async: false })
class MaxSubstitutePriceMatchesPreference implements ValidatorConstraintInterface {
  validate(preference: SubstitutionPreference, args: ValidationArguments): boolean {
    const { maxSubstitutePrice, estimatedUnitPrice } = args.object as ShoppingRequestItemDto;
    const given = maxSubstitutePrice !== undefined && maxSubstitutePrice !== null;
    if (preference !== SubstitutionPreference.SIMILAR_UP_TO) return !given;
    return (
      given && !(typeof estimatedUnitPrice === 'number' && maxSubstitutePrice < estimatedUnitPrice)
    );
  }

  defaultMessage(): string {
    return 'maxSubstitutePrice is required for SIMILAR_UP_TO (and not below estimatedUnitPrice) and must be omitted (or null) for REFUND';
  }
}

@ValidatorConstraint({ name: 'coordinatesComeTogether', async: false })
class CoordinatesComeTogether implements ValidatorConstraintInterface {
  validate(_text: string, args: ValidationArguments): boolean {
    const { latitude, longitude } = args.object as DeliveryAddressDto;
    return (latitude == null) === (longitude == null);
  }

  defaultMessage(): string {
    return 'latitude and longitude must be given together or not at all';
  }
}

export class DeliveryAddressDto {
  @ApiProperty({ example: '12 Admiralty Way, Lekki Phase 1' })
  @TrimmedValue()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Validate(CoordinatesComeTogether)
  text: string;

  @ApiPropertyOptional({ example: 6.45 })
  @RawValue()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 3.47 })
  @RawValue()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class ShoppingRequestItemDto {
  @ApiProperty({ example: 'Full Cream Milk Powder' })
  @TrimmedValue()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'Peak' })
  @TrimmedValue()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  brand: string;

  @ApiProperty({ description: 'Size or weight', example: '400g' })
  @TrimmedValue()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  size: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @RawValue()
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity: number;

  @ApiProperty({ example: 'tin' })
  @TrimmedValue()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit: string;

  @ApiProperty({ description: 'Whole NGN per unit', example: 4500, minimum: 1 })
  @RawValue()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  estimatedUnitPrice: number;

  @ApiPropertyOptional({ example: 'Sealed tins only' })
  @TrimmedValue()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ enum: SubstitutionPreference, example: SubstitutionPreference.REFUND })
  @IsEnum(SubstitutionPreference)
  @Validate(MaxSubstitutePriceMatchesPreference)
  substitutionPreference: SubstitutionPreference;

  @ApiPropertyOptional({
    description: 'Whole NGN per unit. Required for SIMILAR_UP_TO, omit or null for REFUND.',
    nullable: true,
  })
  @RawValue()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  maxSubstitutePrice?: number | null;

  @ApiPropertyOptional({
    description:
      'Shopping category (GET /shopper/categories). Used only to match the request to shoppers ' +
      'who cover it; a request with no categorised item is shown to every shopper at the market.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CreateShoppingRequestDto {
  @ApiProperty({ description: 'Shopping location (market) id' })
  @IsUUID()
  locationId: string;

  @ApiProperty({ type: DeliveryAddressDto })
  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress: DeliveryAddressDto;

  @ApiPropertyOptional({
    description:
      'Coarse area shown to shoppers (e.g. "Lekki Phase 1"). The exact deliveryAddress is never sent to them.',
    example: 'Lekki Phase 1',
  })
  @TrimmedValue()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  handoffArea?: string;

  @ApiProperty({ type: [ShoppingRequestItemDto], maxItems: MAX_REQUEST_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REQUEST_ITEMS)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ShoppingRequestItemDto)
  items: ShoppingRequestItemDto[];

  @ApiPropertyOptional({ example: 'Please call at the gate' })
  @TrimmedValue()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
