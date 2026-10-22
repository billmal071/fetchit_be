import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  ArrayNotEmpty,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CompleteProfileDto {
  @ApiProperty({
    description: 'Short bio describing your skills and experience',
    example: 'Experienced plumber with 5 years in residential and commercial work',
  })
  @IsString()
  @IsNotEmpty()
  bio: string;

  @ApiProperty({ description: 'Service area / location', example: 'Lagos, Ikeja' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiPropertyOptional({ description: 'Location latitude', example: 6.6018 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Location longitude', example: 3.3515 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  longitude?: number;

  @ApiProperty({ description: 'Hourly rate in NGN', example: 5000, minimum: 0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  hourlyRate: number;

  @ApiPropertyOptional({
    description: 'Years of professional experience',
    example: 5,
    minimum: 0,
    maximum: 50,
  })
  @IsNumber()
  @Min(0)
  @Max(50)
  @IsOptional()
  @Type(() => Number)
  yearsOfExperience?: number;

  @ApiProperty({
    description: 'Array of service category IDs the handyman specializes in',
    example: ['uuid-1', 'uuid-2'],
    type: [String],
  })
  @IsArray()
  // Bug #8's apply-to-request guard rejects on zero categories (correctly —
  // nothing to match against) with no self-service way back in, since
  // updateProfile only rewrites categories when the array is non-empty. An
  // empty array here would otherwise be a silent, permanent dead end.
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  categoryIds: string[];
}
