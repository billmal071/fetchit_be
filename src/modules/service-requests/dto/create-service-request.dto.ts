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
  @IsUUID()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
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
  @IsOptional()
  @Type(() => Number)
  budgetMin?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ValidateIf((o) => o.budgetMax != null)
  @Validate(BudgetMaxValidator)
  budgetMax?: number;
}
