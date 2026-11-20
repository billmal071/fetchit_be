import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Weekday } from '@prisma/client';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilitySlotDto {
  @ApiProperty({ enum: Weekday, example: Weekday.MONDAY })
  @IsEnum(Weekday)
  weekday: Weekday;

  @ApiPropertyOptional({ description: 'HH:mm, 24-hour', example: '08:00' })
  @IsOptional()
  @Matches(HH_MM, { message: 'startTime must be HH:mm (24-hour)' })
  startTime?: string;

  @ApiPropertyOptional({ description: 'HH:mm, 24-hour', example: '18:00' })
  @IsOptional()
  @Matches(HH_MM, { message: 'endTime must be HH:mm (24-hour)' })
  endTime?: string;
}

/** Fields a shopper can edit, shared by onboarding and PATCH /shopper/profile. */
class ShopperProfileFieldsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 60, example: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  @Type(() => Number)
  yearsOfExperience?: number;

  @ApiPropertyOptional({ type: [String], description: 'Extra-service ids (optional)' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds?: string[];

  @ApiPropertyOptional({ type: [AvailabilitySlotDto], description: 'At most one slot per day' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability?: AvailabilitySlotDto[];
}

export class OnboardShopperDto extends ShopperProfileFieldsDto {
  @ApiProperty({ example: 'Amaka O.', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName: string;

  @ApiProperty({ example: 'Six years buying for restaurants around Mile 12.', minLength: 10 })
  @IsString()
  @MinLength(10)
  bio: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
    maxLength: 20,
    description: 'Spaces, hyphens and brackets are ignored',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @Matches(/^\+?[0-9]{7,19}$/, { message: 'phone must be 7-19 digits, optionally starting with +' })
  phone?: string;

  @ApiProperty({ type: [String], description: 'At least one category id' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  categoryIds: string[];

  @ApiProperty({ type: [String], description: 'At least one location id' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  locationIds: string[];
}

export class UpdateShopperProfileDto extends ShopperProfileFieldsDto {
  @ApiPropertyOptional({ minLength: 10 })
  @IsOptional()
  @IsString()
  @MinLength(10)
  bio?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ type: [String], description: 'Replaces the current set; never empty' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Replaces the current set; never empty' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  locationIds?: string[];
}

export class SetAvailabilityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isOnline: boolean;
}
