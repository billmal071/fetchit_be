import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsNumber,
  Min,
  IsUUID,
  ValidateIf,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'isBudgetMaxValid', async: false })
class BudgetMaxValidator implements ValidatorConstraintInterface {
  validate(budgetMax: number, args: ValidationArguments): boolean {
    const obj = args.object as CreateServiceRequestDto;
    if (obj.budgetMin == null || budgetMax == null) return true;
    return budgetMax >= obj.budgetMin;
  }

  defaultMessage(): string {
    return 'budgetMax must be greater than or equal to budgetMin';
  }
}

export class CreateServiceRequestDto {
  @ApiProperty({
    description: 'Service category ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ description: 'Brief title', example: 'Fix leaking kitchen sink' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    description: 'Detailed description of the work needed',
    example:
      'The kitchen sink has been leaking for two days. Water drips from the pipe under the sink when the faucet is on.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Service location address', example: 'Lagos, Ikeja' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
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

  @ApiPropertyOptional({ description: 'Minimum budget in NGN', example: 5000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  budgetMin?: number;

  @ApiPropertyOptional({ description: 'Maximum budget in NGN', example: 15000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ValidateIf((o) => o.budgetMax != null)
  @Validate(BudgetMaxValidator)
  budgetMax?: number;
}
