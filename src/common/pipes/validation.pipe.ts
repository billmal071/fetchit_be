import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class CustomValidationPipe implements PipeTransform<unknown> {
  async transform(value: unknown, { metatype }: ArgumentMetadata): Promise<unknown> {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToInstance(metatype, value);
    const errors = await validate(object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    if (errors.length > 0) {
      const formattedErrors = errors.map((error) => {
        const constraints = error.constraints || {};
        return {
          field: error.property,
          message: Object.values(constraints).join(', '),
          value: error.value,
        };
      });

      throw new BadRequestException({
        message: 'Validation failed',
        details: formattedErrors,
      });
    }

    return object;
  }

  private toValidate(metatype: unknown): boolean {
    const types: unknown[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
