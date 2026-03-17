import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CompleteProfileDto {
  @IsString()
  @IsNotEmpty()
  bio: string;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  latitude?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  longitude?: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  hourlyRate: number;

  @IsNumber()
  @Min(0)
  @Max(50)
  @IsOptional()
  @Type(() => Number)
  yearsOfExperience?: number;

  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds: string[];
}
